import chalk from 'chalk';
import { writeFileSync } from 'fs';
import type { MysqlEntity } from '../../dialects/mysql/ddl';
import { createDDL } from '../../dialects/mysql/ddl';
import { Binary, Varbinary } from '../../dialects/mysql/grammar';
import type { MysqlSchemaV6, MysqlSnapshot, MysqlSnapshotV6 } from '../../dialects/mysql/snapshot';
import { trimChar } from '../../utils';
import { prepareOutFolder, validateWithReport } from '../../utils/utils-node';
import { outputFormat } from '../context';
import { migrateToFoldersV3 } from './utils';

export const upMysqlHandler = (out: string): string[] => {
	migrateToFoldersV3(out);

	const { snapshots } = prepareOutFolder(out);
	const report = validateWithReport(snapshots, 'mysql');

	const upgraded: string[] = [];
	report.nonLatest
		.map((it) => ({
			path: it,
			raw: report.rawMap[it] as Record<string, any>,
		}))
		.forEach((it) => {
			const path = it.path;

			const snapshot = upToV7(it.raw);

			if (outputFormat() === 'text') console.log(`[${chalk.green('✓')}] ${path}`);

			writeFileSync(path, JSON.stringify(snapshot, null, 2));

			upgraded.push(path);
		});

	if (outputFormat() === 'text') console.log("Everything's fine 🐶🔥");

	return upgraded;
};

export const upToV7 = (it: Record<string, any>): MysqlSnapshot => {
	const raw = Number(it['version']) === 6 ? it as MysqlSnapshotV6 : upToV6(it);

	// v7 qualified entities with the database name, '' stands for the default database
	const ddl = raw.ddl.map((entity) => {
		const { entityType } = entity;
		if (entityType === 'fks') return { schema: '', schemaTo: '', ...entity };
		if (
			entityType === 'tables' || entityType === 'columns' || entityType === 'pks'
			|| entityType === 'indexes' || entityType === 'checks' || entityType === 'views'
		) {
			return { schema: '', ...entity };
		}
		return entity;
	}) as MysqlEntity[];

	return {
		version: '7',
		dialect: 'mysql',
		id: raw.id,
		prevIds: raw.prevIds,
		ddl,
		renames: raw.renames as string[],
	};
};

export const upToV6 = (it: Record<string, any>): MysqlSnapshotV6 => {
	const json = it as MysqlSchemaV6;

	const ddl = createDDL();

	for (const table of Object.values(json.tables)) {
		ddl.tables.push({ schema: '', name: table.name });

		for (const column of Object.values(table.columns)) {
			let def = typeof column.default === 'undefined' ? null : String(column.default);
			if (def !== null) {
				if (column.type.startsWith('decimal')) def = `(${trimChar(def, "'")})`;
				if (column.type.startsWith('binary')) {
					const trimmed = trimChar(def, "'");
					if (trimmed !== def) def = Binary.defaultFromDrizzle(trimmed)!;
				}
				if (column.type.startsWith('varbinary')) {
					const trimmed = trimChar(def, "'");
					// check if it's not an expression
					if (trimmed !== def) def = Varbinary.defaultFromDrizzle(trimmed);
				}
			}

			ddl.columns.push({
				schema: '',
				table: table.name,
				name: column.name,
				type: column.type,
				notNull: column.notNull,
				default: def,
				autoIncrement: column.autoincrement ?? false,
				onUpdateNow: column.onUpdate ?? false,
				generated: column.generated,
				// TODO: @AleksandrSherman check
				charSet: null,
				collation: null,
				onUpdateNowFsp: null,
			});
		}
	}
	for (const table of Object.values(json.tables)) {
		for (const index of Object.values(table.indexes)) {
			/* legacy columns mapper
				const uniqueString = unsquashedUnique.columns
					.map((it) => {
						return internals?.indexes
							? internals?.indexes[unsquashedUnique.name]?.columns[it]
									?.isExpression
								? it
								: `\`${it}\``
							: `\`${it}\``;
					})
					.join(',');
			 */

			const columns = index.columns.map((x) => {
				const nameToCheck = trimChar(x, '`');
				const isColumn = !!ddl.columns.one({
					table: table.name,
					name: nameToCheck,
				});
				return { value: x, isExpression: !isColumn };
			});

			ddl.indexes.push({
				schema: '',
				table: table.name,
				name: index.name,
				columns,
				algorithm: index.algorithm ?? null,
				isUnique: index.isUnique,
				lock: index.lock ?? null,
				using: index.using ?? null,
				nameExplicit: true,
			});
		}

		if (table.uniqueConstraints) {
			for (const unique of Object.values(table.uniqueConstraints)) {
				/* legacy columns mapper
				const uniqueString = unsquashedUnique.columns
					.map((it) => {
						return internals?.indexes
							? internals?.indexes[unsquashedUnique.name]?.columns[it]
									?.isExpression
								? it
								: `\`${it}\``
							: `\`${it}\``;
					})
					.join(',');
			 */
				const columns = unique.columns.map((x) => {
					const nameToCheck = trimChar(x, '`');
					const isColumn = !!ddl.columns.one({
						table: table.name,
						name: nameToCheck,
					});
					return { value: x, isExpression: !isColumn };
				});

				let nameImplicit = `${table.name}_${unique.columns.join('_')}_unique` === unique.name
					|| `${table.name}_${unique.columns.join('_')}` === unique.name;

				ddl.indexes.push({
					schema: '',
					table: table.name,
					name: unique.name,
					columns,
					algorithm: null,
					isUnique: true,
					lock: null,
					using: null,
					nameExplicit: !nameImplicit,
				});
			}
		}

		if (table.foreignKeys) {
			for (const fk of Object.values(table.foreignKeys)) {
				const isNameImplicit = `${fk.tableFrom}_${fk.columnsFrom.join('_')}_${fk.tableTo}_${fk.columnsTo.join('_')}_fk`
					=== fk.name;

				ddl.fks.push({
					schema: '',
					table: table.name,
					name: fk.name,
					columns: fk.columnsFrom,
					columnsTo: fk.columnsTo,
					schemaTo: '',
					tableTo: fk.tableTo,
					onUpdate: (fk.onUpdate?.toUpperCase() as any) ?? null,
					onDelete: (fk.onDelete?.toUpperCase() as any) ?? null,
					nameExplicit: !isNameImplicit,
				});
			}
		}

		if (table.checkConstraint) {
			for (const check of Object.values(table.checkConstraint)) {
				ddl.checks.push({
					schema: '',
					table: table.name,
					name: check.name,
					value: check.value,
				});
			}

			for (const pk of Object.values(table.compositePrimaryKeys)) {
				ddl.pks.push({
					schema: '',
					table: table.name,
					name: 'PRIMARY',
					columns: pk.columns,
				});
			}
		}
	}

	if (json.views) {
		for (const view of Object.values(json.views)) {
			ddl.views.push({
				schema: '',
				name: view.name,
				algorithm: view.algorithm ?? null,
				sqlSecurity: view.sqlSecurity ?? null,
				withCheckOption: view.withCheckOption ?? null,
				definition: view.definition!,
			});
		}
	}

	return {
		version: '6',
		id: json.id,
		prevIds: [json.prevId],
		dialect: 'mysql',
		ddl: ddl.entities.list(),
		renames: [],
	};
};
