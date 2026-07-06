import type {
	CheckConstraint,
	Column,
	ForeignKey,
	Index,
	InterimColumn,
	InterimSchema,
	MysqlEntities,
	PrimaryKey,
	View,
	ViewColumn,
} from '../dialects/mysql/ddl';
import { interimToDDL } from '../dialects/mysql/ddl';
import { ddlDiff } from '../dialects/mysql/diff';
import { fromDatabase as fd } from '../dialects/mysql/introspect';
import { mockResolver } from '../utils/mocks';

// `schema`/`schemaTo` are the database names, optional for compatibility, '' is the default database
export type Interim<T> = Omit<T, 'entityType' | 'schema' | 'schemaTo'> & {
	schema?: string;
	schemaTo?: T extends { schemaTo: string } ? string : never;
};

export type InterimTable = {
	schema?: string;
	name: string;
	columns: Interim<InterimColumn>[];
	indexes: Interim<Index>[];
	checks: Interim<CheckConstraint>[];
	pks: Interim<PrimaryKey>[];
	fks: Interim<ForeignKey>[];
};

export type InterimView = {
	schema?: string;
	name: string;
	columns: Interim<Column>[];
	definition: string;
	algorithm: 'undefined' | 'merge' | 'temptable';
	sqlSecurity: 'definer' | 'invoker';
	withCheckOption: 'local' | 'cascaded' | null;
};

export type InterimStudioSchema = {
	tables: InterimTable[];
	views: InterimView[];
};

const fromInterims = ({
	tables,
	views,
}: InterimStudioSchema): InterimSchema => {
	const tbls: MysqlEntities['tables'][] = tables.map((it) => ({
		entityType: 'tables',
		schema: it.schema ?? '',
		name: it.name,
	}));
	const columns: InterimColumn[] = tables
		.map((table) => {
			return table.columns.map((it) => {
				return {
					entityType: 'columns',
					...it,
					schema: it.schema ?? table.schema ?? '',
				} satisfies InterimColumn;
			});
		})
		.flat(1);

	const indexes: Index[] = tables
		.map((table) => {
			return table.indexes.map((it) => {
				return { entityType: 'indexes', ...it, schema: it.schema ?? table.schema ?? '' } satisfies Index;
			});
		})
		.flat(1);

	const checks: CheckConstraint[] = tables
		.map((table) => {
			return table.checks.map((it) => {
				return { entityType: 'checks', ...it, schema: it.schema ?? table.schema ?? '' } satisfies CheckConstraint;
			});
		})
		.flat(1);
	const fks: ForeignKey[] = tables
		.map((table) => {
			return table.fks.map((it) => {
				return {
					entityType: 'fks',
					...it,
					schema: it.schema ?? table.schema ?? '',
					schemaTo: it.schemaTo ?? '',
				} satisfies ForeignKey;
			});
		})
		.flat(1);
	const pks: PrimaryKey[] = tables
		.map((table) => {
			return table.pks.map((it) => {
				return { entityType: 'pks', ...it, schema: it.schema ?? table.schema ?? '' } satisfies PrimaryKey;
			});
		})
		.flat(1);

	const vws: View[] = views.map(({ columns: _, ...it }) => {
		return {
			entityType: 'views',
			schema: it.schema ?? '',
			algorithm: it.algorithm,
			definition: it.definition,
			name: it.name,
			sqlSecurity: it.sqlSecurity,
			withCheckOption: it.withCheckOption,
		};
	});
	const viewColumns: ViewColumn[] = views
		.map((table) => {
			return table.columns.map((it) => {
				return {
					view: table.name,
					...it,
					schema: it.schema ?? table.schema ?? '',
				} satisfies ViewColumn;
			});
		})
		.flat(1);

	return {
		schemas: [],
		tables: tbls,
		columns: columns,
		pks,
		fks,
		checks,
		indexes,
		views: vws,
		viewColumns,
	};
};

export const diffMySql = async (from: InterimStudioSchema, to: InterimStudioSchema, renamesArr: string[]) => {
	const { ddl: ddl1 } = interimToDDL(fromInterims(from));
	const { ddl: ddl2 } = interimToDDL(fromInterims(to));

	const renames = new Set(renamesArr);

	const { sqlStatements, groupedStatements, statements } = await ddlDiff(
		ddl1,
		ddl2,
		mockResolver(renames),
		mockResolver(renames),
		mockResolver(renames),
		mockResolver(renames),
		'default',
	);

	return { sqlStatements, groupedStatements, statements };
};

export const fromDatabase = fd;
