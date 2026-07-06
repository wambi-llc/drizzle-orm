import { toCamelCase } from 'drizzle-orm/casing';
import type { Casing } from '../../cli/validations/common';
import { assertUnreachable } from '../../utils';
import { inspect } from '../utils';
import type { CheckConstraint, Column, ForeignKey, Index, MysqlDDL, PrimaryKey, ViewColumn } from './ddl';
import { Enum, parseEnum, typeFor } from './grammar';

export const imports = [
	'boolean',
	'tinyint',
	'smallint',
	'mediumint',
	'int',
	'bigint',
	'binary',
	'char',
	'date',
	'datetime',
	'decimal',
	'double',
	'float',
	'json',
	'real',
	'serial',
	'text',
	'tinytext',
	'mediumtext',
	'longtext',
	'time',
	'timestamp',
	'varbinary',
	'varchar',
	'year',
	'mysqlEnum',
	'singlestoreEnum',
	'customType',
	'mediumblob',
	'blob',
	'tinyblob',
	'longblob',
	// TODO: add new type BSON
	// TODO: add new type UUID
	// TODO: add new type GUID
	// TODO: add new type Vector
	// TODO: add new type GeoPoint
] as const;
export type Import = typeof imports[number];

const mysqlImportsList = new Set([
	'mysqlTable',
	'singlestoreTable',
	...imports,
]);

const objToStatement2 = (json: any) => {
	json = Object.fromEntries(Object.entries(json).filter((it) => it[1]));
	const keys = Object.keys(json);
	if (keys.length === 0) return;

	let statement = '{ ';
	statement += keys.map((it) => `${it}: "${json[it]}"`).join(', '); // no "" for keys
	statement += ' }';
	return statement;
};

const relations = new Set<string>();

const escapeColumnKey = (value: string) => {
	if (/^(?![a-zA-Z_$][a-zA-Z0-9_$]*$).+$/.test(value)) {
		return `"${value}"`;
	}
	return value;
};

const prepareCasing = (casing?: Casing) => (value: string) => {
	if (casing === 'preserve') {
		return escapeColumnKey(value);
	}
	if (casing === 'camel') {
		return escapeColumnKey(toCamelCase(value));
	}

	assertUnreachable(casing);
};

const dbColumnName = ({ name, casing, withMode = false }: { name: string; casing: Casing; withMode?: boolean }) => {
	if (casing === 'preserve') {
		return '';
	}
	if (casing === 'camel') {
		return toCamelCase(name) === name ? '' : withMode ? `"${name}", ` : `"${name}"`;
	}

	assertUnreachable(casing);
};

// tables of non-default databases get an `In${db}` suffix to avoid collisions with
// same-named tables of the default database
export const paramNameFor = (name: string, schema: string) => {
	const schemaSuffix = schema ? `In${schema.capitalise()}` : '';
	return `${name}${schemaSuffix}`;
};

export const ddlToTypeScript = (
	ddl: MysqlDDL,
	viewColumns: ViewColumn[],
	casing: Casing,
	vendor: 'mysql' | 'singlestore',
) => {
	const withCasing = prepareCasing(casing);

	for (const fk of ddl.fks.list()) {
		const relation = `${fk.schema}.${fk.table}-${fk.schemaTo}.${fk.tableTo}`;
		relations.add(relation);
	}

	// databases beyond the connection's default one, both declared and derived from entities
	const schemas = Object.fromEntries(
		[
			...ddl.schemas.list().map((it) => it.name),
			...ddl.tables.list().map((it) => it.schema),
			...ddl.views.list().map((it) => it.schema),
		].filter((it) => it !== '').map((it) => [it, withCasing(it)]),
	);

	const imports = new Set<string>([
		vendor === 'mysql' ? 'mysqlTable' : 'signlestoreTable',
		vendor === 'mysql' ? 'mysqlSchema' : 'singlestoreSchema',
		vendor === 'mysql' ? 'AnyMySqlColumn' : 'AnySinsgleStoreColumn',
	]);

	const viewEntities = viewColumns.map((it) => {
		return {
			entityType: 'viewColumn',
			...it,
		} as const;
	});

	for (const it of [...ddl.entities.list(), ...viewEntities]) {
		if (it.entityType === 'indexes') imports.add(it.isUnique ? 'uniqueIndex' : 'index');
		if (it.entityType === 'fks') imports.add('foreignKey');
		if (it.entityType === 'pks' && (it.columns.length > 1)) imports.add('primaryKey');
		if (it.entityType === 'checks') imports.add('check');
		if (it.entityType === 'views') imports.add(vendor === 'mysql' ? 'mysqlView' : 'singlestoreView');

		if (it.entityType === 'columns' || it.entityType === 'viewColumn') {
			const grammarType = typeFor(it.type);
			imports.add(grammarType.drizzleImport(vendor));
			if (mysqlImportsList.has(it.type)) imports.add(it.type);
		}
	}

	const schemaStatements = Object.entries(schemas).map(([name, key]) => {
		return `export const ${key} = ${vendor === 'mysql' ? 'mysqlSchema' : 'singlestoreSchema'}("${name}");`;
	});

	const tableStatements = [] as string[];
	for (const table of ddl.tables.list()) {
		const tableFn = table.schema ? `${schemas[table.schema]}.table` : `${vendor}Table`;
		const filter = { schema: table.schema, table: table.name };

		let statement = `export const ${
			withCasing(paramNameFor(table.name, table.schema))
		} = ${tableFn}("${table.name}", {\n`;
		statement += createTableColumns(
			ddl.columns.list(filter),
			ddl.pks.one(filter),
			ddl.fks.list(filter),
			withCasing,
			casing,
			vendor,
		);
		statement += '}';

		const fks = ddl.fks.list(filter);
		const indexes = ddl.indexes.list(filter);
		const checks = ddl.checks.list(filter);
		const pk = ddl.pks.one(filter);

		// more than 2 fields or self reference or cyclic
		const filteredFKs = fks.filter((it) => {
			return it.columns.length > 1 || isSelf(it);
		});

		const hasIndexes = indexes.length > 0;
		const hasFKs = filteredFKs.length > 0;
		const hasPK = pk && pk.columns.length > 1;
		const hasChecks = checks.length > 0;
		const hasCallbackParams = hasIndexes || hasFKs || hasPK || hasChecks;

		if (hasCallbackParams) {
			statement += ',\n';
			statement += '(table) => [\n';
			statement += hasPK ? createTablePK(pk, withCasing) : '';
			statement += createTableIndexes(indexes, withCasing);
			statement += createTableFKs(filteredFKs, withCasing);
			statement += createTableChecks(checks);
			statement += ']';
		}

		statement += ');';

		tableStatements.push(statement);
	}

	const viewsStatements = [] as string[];
	for (const view of ddl.views.list()) {
		const { name, algorithm, definition, sqlSecurity, withCheckOption } = view;
		const columns = viewColumns.filter((x) => x.schema === view.schema && x.view === view.name);
		const viewFn = view.schema ? `${schemas[view.schema]}.view` : `${vendor}View`;

		let statement = '';
		statement += `export const ${withCasing(paramNameFor(name, view.schema))} = ${viewFn}("${name}", {\n`;
		statement += createViewColumns(columns, withCasing, casing, vendor);
		statement += '})';

		statement += algorithm ? `.algorithm("${algorithm}")` : '';
		statement += sqlSecurity ? `.sqlSecurity("${sqlSecurity}")` : '';
		statement += withCheckOption ? `.withCheckOption("${withCheckOption}")` : '';
		statement += `.as(sql\`${definition?.replaceAll('`', '\\`')}\`);`;

		viewsStatements.push(statement);
	}

	const importsTs = `import { ${
		[...imports].join(
			', ',
		)
	} } from "drizzle-orm/${vendor}-core"\nimport { sql } from "drizzle-orm"\n\n`;

	let decalrations = '';
	decalrations += schemaStatements.length > 0 ? schemaStatements.join('\n') + '\n\n' : '';
	decalrations += tableStatements.join('\n\n');
	decalrations += '\n';
	decalrations += viewsStatements.join('\n\n');

	const file = importsTs + decalrations;

	const schemaEntry = `
    {
      ${
		Object.values(ddl.tables)
			.map((it) => withCasing(it.name))
			.join(',')
	}
    }
  `;

	return {
		file, // backward compatible, print to file
		imports: importsTs,
		decalrations,
		schemaEntry,
	};
};

const isCyclic = (fk: ForeignKey) => {
	const key = `${fk.schema}.${fk.table}-${fk.schemaTo}.${fk.tableTo}`;
	const reverse = `${fk.schemaTo}.${fk.tableTo}-${fk.schema}.${fk.table}`;
	return relations.has(key) && relations.has(reverse);
};

const isSelf = (fk: ForeignKey) => {
	return fk.schema === fk.schemaTo && fk.table === fk.tableTo;
};

const column = (
	type: string,
	name: string,
	casing: (value: string) => string,
	rawCasing: Casing,
	defaultValue: Column['default'],
	autoincrement: boolean,
	onUpdateNow: Column['onUpdateNow'],
	onUpdateNowFsp: Column['onUpdateNowFsp'],
	collation: Column['collation'],
	charSet: Column['charSet'],
	vendor: 'mysql' | 'singlestore',
) => {
	let lowered = type.startsWith('enum(') ? type : type.toLowerCase();
	if (lowered.startsWith('enum')) {
		const values = parseEnum(lowered).map((it) => `"${it.replaceAll("''", "'").replaceAll('"', '\\"')}"`).join(',');
		let out = `${casing(name)}: ${vendor}Enum(${dbColumnName({ name, casing: rawCasing, withMode: true })}[${values}])`;

		const { default: def } = Enum.toTs('', defaultValue) as any;
		out += def ? `.default(${def})` : '';
		out += charSet ? `.charSet("${charSet}")` : '';
		out += collation ? `.collate("${collation}")` : '';

		return out;
	}

	if (lowered === 'serial') {
		return `${casing(name)}: serial(${dbColumnName({ name, casing: rawCasing })})`;
	}

	const grammarType = typeFor(lowered);
	const key = casing(name);
	const columnName = dbColumnName({ name, casing: rawCasing });
	const ts = grammarType.toTs(lowered, defaultValue);
	const { default: def, options, customType } = typeof ts === 'string' ? { default: ts, options: {} } : ts;

	const drizzleType = grammarType.drizzleImport();
	const defaultStatement = def ? def.startsWith('.') ? def : `.default(${def})` : '';
	const paramsString = inspect(options);
	const comma = columnName && paramsString ? ', ' : '';

	let res = `${key}: ${drizzleType}${
		customType ? `({ dataType: () => '${customType}' })` : ''
	}(${columnName}${comma}${paramsString})`;
	res += autoincrement ? `.autoincrement()` : '';
	res += defaultStatement;
	res += onUpdateNow ? `.onUpdateNow(${onUpdateNowFsp ? '{ fsp: ' + onUpdateNowFsp + ' }' : ''})` : '';
	res += charSet ? `.charSet("${charSet}")` : '';
	res += collation ? `.collate("${collation}")` : '';

	return res;
};

const createTableColumns = (
	columns: Column[],
	pk: PrimaryKey | null,
	fks: ForeignKey[],
	casing: (val: string) => string,
	rawCasing: Casing,
	vendor: 'mysql' | 'singlestore',
): string => {
	let statement = '';

	for (const it of columns) {
		const isPK = pk && pk.columns.length === 1 && pk.columns[0] === it.name;

		statement += '\t';
		statement += column(
			it.type,
			it.name,
			casing,
			rawCasing,
			it.default,
			it.autoIncrement,
			it.onUpdateNow,
			it.onUpdateNowFsp,
			it.collation,
			it.charSet,
			vendor,
		);

		statement += isPK ? '.primaryKey()' : '';
		statement += it.notNull && !isPK ? '.notNull()' : '';

		statement += it.generated
			? `.generatedAlwaysAs(sql\`${
				it.generated.as.replace(
					/`/g,
					'\\`',
				)
			}\`, { mode: "${it.generated.type}" })`
			: '';

		const columnFKs = fks.filter((x) => x.columns.length === 1 && x.columns[0] === it.name && !isSelf(x));

		for (const fk of columnFKs) {
			const onDelete = fk.onDelete !== 'NO ACTION' ? fk.onDelete?.toLowerCase() : null;
			const onUpdate = fk.onUpdate !== 'NO ACTION' ? fk.onUpdate?.toLowerCase() : null;
			const params = { onDelete, onUpdate };

			const typeSuffix = isCyclic(fk) ? vendor === 'mysql' ? ': AnyMySqlColumn' : ': AnySinsgleStoreColumn' : '';

			const paramsStr = objToStatement2(params);
			if (paramsStr) {
				statement += `.references(()${typeSuffix} => ${
					casing(
						paramNameFor(fk.tableTo, fk.schemaTo),
					)
				}.${casing(fk.columnsTo[0])}, ${paramsStr} )`;
			} else {
				statement += `.references(()${typeSuffix} => ${casing(paramNameFor(fk.tableTo, fk.schemaTo))}.${
					casing(
						fk.columnsTo[0],
					)
				})`;
			}
		}
		statement += ',\n';
	}

	return statement;
};

const createViewColumns = (
	columns: ViewColumn[],
	casing: (value: string) => string,
	rawCasing: Casing,
	vendor: 'mysql' | 'singlestore',
) => {
	let statement = '';

	for (const it of columns) {
		statement += '\n';
		statement += column(it.type, it.name, casing, rawCasing, null, false, false, null, null, null, vendor);
		statement += it.notNull ? '.notNull()' : '';
		statement += ',\n';
	}
	return statement;
};

const createTableIndexes = (
	idxs: Index[],
	casing: (value: string) => string,
): string => {
	let statement = '';
	for (const it of idxs) {
		const columns = it.columns.map((x) =>
			x.isExpression ? `sql\`${x.value.replaceAll('`', '\\`')}\`` : `table.${casing(x.value)}`
		).join(', ');
		statement += it.isUnique ? '\tuniqueIndex(' : '\tindex(';
		statement += `"${it.name}")`;
		statement += `.on(${columns}),\n`;
	}
	return statement;
};

const createTableChecks = (
	checks: CheckConstraint[],
): string => {
	let statement = '';

	for (const it of checks) {
		statement += `\tcheck("${it.name}", sql\`${it.value.replace(/`/g, '\\`')}\`),\n`;
	}

	return statement;
};

const createTablePK = (pk: PrimaryKey, casing: (value: string) => string): string => {
	const columns = pk.columns.map((x) => `table.${casing(x)}`).join(', ');
	let statement = `\tprimaryKey({ columns: [${columns}] }),`;
	return statement;
};

const createTableFKs = (
	fks: ForeignKey[],
	casing: (value: string) => string,
): string => {
	let statement = '';

	for (const it of fks) {
		const tableTo = isSelf(it) ? 'table' : `${casing(paramNameFor(it.tableTo, it.schemaTo))}`;
		const columnsFrom = it.columns.map((x) => `table.${casing(x)}`).join(', ');
		const columnsTo = it.columnsTo.map((x) => `${tableTo}.${casing(x)}`).join(', ');
		statement += `\tforeignKey({\n`;
		statement += `\t\tcolumns: [${columnsFrom}],\n`;
		statement += `\t\tforeignColumns: [${columnsTo}],\n`;
		statement += `\t\tname: "${it.name}"\n`;
		statement += `\t})`;
		statement += it.onUpdate !== 'NO ACTION' ? `.onUpdate("${it.onUpdate?.toLowerCase()}")` : '';
		statement += it.onDelete !== 'NO ACTION' ? `.onDelete("${it.onDelete?.toLowerCase()}")` : '';
		statement += `,\n`;
	}

	return statement;
};
