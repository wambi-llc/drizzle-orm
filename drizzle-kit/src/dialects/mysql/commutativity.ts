import {
	AbstractCommutativity,
	type CommutativityStatementDefinitions,
	type CommutativityStatementInfo,
} from '../../commutativity/engine';
import type { ConflictTarget } from '../../commutativity/types';
import { createDDL, type MysqlDDL } from './ddl';
import { ddlDiffDry } from './diff';
import { drySnapshot, type MysqlSnapshot } from './snapshot';
import type { JsonStatement } from './statements';

type FootprintTarget = {
	schema: string;
	objectName: string;
	columnName: string;
};

type StatementInfo = CommutativityStatementInfo<JsonStatement, FootprintTarget>;

type StatementDefinitions = CommutativityStatementDefinitions<
	JsonStatement,
	FootprintTarget
>;

function makeTarget(schema: string, objectName: string, columnName = ''): FootprintTarget {
	return { schema, objectName, columnName };
}

function makeSchemaTarget(schemaName: string): FootprintTarget {
	return makeTarget(schemaName, '');
}

/**
 * MySQL-specific commutativity rules.
 *
 * How to read this file:
 * - `getStatementDefinitions()` is the main source of truth.
 * - Each statement definition answers two questions:
 *   1. `conflicts`: which other statement types are incompatible with this one.
 *   2. `buildInfo`: which resource footprints this statement occupies.
 * - `buildInfo().primary` is the exact resource touched by the statement.
 * - `buildInfo().ancestors` are explicit parent resources, usually the owning table.
 * - `getImplicitAncestors()` adds the database-level footprint for every target of a
 *   non-default database (a `mysqlSchema()`/`mysqlDatabase()` one), so database
 *   operations can conflict with tables, columns, indexes and views inside it.
 *
 * Practical guide for fixes:
 * - False positive or missed conflict for same-level objects like column->column,
 *   index->index, table->table, or view->view:
 *   change the `conflicts` array for the relevant statements in
 *   `getStatementDefinitions()`.
 * - False positive or missed conflict for parent/child relations like
 *   table->column or table->index:
 *   adjust the child's `ancestors` in `buildInfo()` and/or the parent's
 *   `conflicts` array.
 * - False positive or missed conflict for schema->table, schema->column,
 *   schema->index or schema->view: first check `schemaConflictTypes`, because that
 *   defines what schema operations conflict with. If schema ancestry itself is
 *   wrong, adjust `getImplicitAncestors()`.
 * - Wrong human-readable conflict message only:
 *   change `describeStatement()` or `schemaLevelActions`. Those affect reporting,
 *   not matching semantics.
 *
 * Rule of thumb:
 * - If the problem is "these two statement types should or should not conflict",
 *   edit `conflicts`.
 * - If the problem is "this statement is matched at the wrong scope",
 *   edit `primary` or `ancestors`.
 */
class MysqlCommutativity extends AbstractCommutativity<
	JsonStatement,
	MysqlSnapshot,
	FootprintTarget
> {
	private schemaLevelActions = new Set([
		'create_table',
		'drop_table',
		'rename_table',
		'create_view',
		'drop_view',
		'alter_view',
		'rename_view',
	]);

	private schemaConflictTypes: JsonStatement['type'][] = [
		'create_schema',
		'drop_schema',
		'rename_schema',
		'create_table',
		'drop_table',
		'rename_table',
		'add_column',
		'drop_column',
		'alter_column',
		'recreate_column',
		'rename_column',
		'create_index',
		'drop_index',
		'create_pk',
		'drop_pk',
		'create_fk',
		'drop_constraint',
		'create_check',
		'create_view',
		'drop_view',
		'rename_view',
		'alter_view',
	];

	protected override getStatementDefinitions(): StatementDefinitions {
		return {
			// Database operations
			create_schema: {
				conflicts: this.schemaConflictTypes,
				buildInfo: (statement) => ({
					primary: makeSchemaTarget(statement.name),
					ancestors: [],
				}),
			},
			drop_schema: {
				conflicts: this.schemaConflictTypes,
				buildInfo: (statement) => ({
					primary: makeSchemaTarget(statement.name),
					ancestors: [],
				}),
			},
			rename_schema: {
				conflicts: this.schemaConflictTypes,
				buildInfo: (statement) => ({
					primary: makeSchemaTarget(statement.from.name),
					ancestors: [],
				}),
			},

			// Table operations
			create_table: {
				conflicts: ['create_table', 'drop_table', 'rename_table'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.table.schema, statement.table.name),
					ancestors: [],
				}),
			},
			drop_table: {
				conflicts: [
					'create_table',
					'drop_table',
					'rename_table',
					'add_column',
					'drop_column',
					'alter_column',
					'recreate_column',
					'rename_column',
					'create_index',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.schema, statement.table),
					ancestors: [],
				}),
			},
			rename_table: {
				conflicts: [
					'create_table',
					'drop_table',
					'rename_table',
					'create_index',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.schemaFrom, statement.from),
					ancestors: [],
				}),
			},

			// Column operations
			add_column: {
				conflicts: [
					'add_column',
					'alter_column',
					'drop_column',
					'rename_column',
					'recreate_column',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.column.schema, statement.column.table, statement.column.name),
					ancestors: [makeTarget(statement.column.schema, statement.column.table)],
				}),
			},
			drop_column: {
				conflicts: [
					'add_column',
					'drop_column',
					'alter_column',
					'rename_column',
					'recreate_column',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.column.schema, statement.column.table, statement.column.name),
					ancestors: [makeTarget(statement.column.schema, statement.column.table)],
				}),
			},
			alter_column: {
				conflicts: [
					'add_column',
					'drop_column',
					'alter_column',
					'rename_column',
					'recreate_column',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.diff.schema, statement.diff.table, statement.column.name),
					ancestors: [makeTarget(statement.diff.schema, statement.diff.table)],
				}),
			},
			recreate_column: {
				conflicts: [
					'add_column',
					'drop_column',
					'alter_column',
					'recreate_column',
					'rename_column',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.column.schema, statement.column.table, statement.column.name),
					ancestors: [makeTarget(statement.column.schema, statement.column.table)],
				}),
			},
			rename_column: {
				conflicts: [
					'add_column',
					'drop_column',
					'alter_column',
					'recreate_column',
					'rename_column',
				],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.schema, statement.table, statement.from),
					ancestors: [makeTarget(statement.schema, statement.table)],
				}),
			},

			// Index operations
			create_index: {
				conflicts: ['create_index', 'drop_index', 'drop_table'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.index.schema, statement.index.table, statement.index.name),
					ancestors: [makeTarget(statement.index.schema, statement.index.table)],
				}),
			},
			drop_index: {
				conflicts: ['create_index', 'drop_index'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.index.schema, statement.index.table, statement.index.name),
					ancestors: [makeTarget(statement.index.schema, statement.index.table)],
				}),
			},

			// Primary key operations
			drop_pk: {
				conflicts: ['drop_pk', 'create_pk'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.pk.schema, statement.pk.table),
					ancestors: [],
				}),
			},
			create_pk: {
				conflicts: ['drop_pk', 'create_pk'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.pk.schema, statement.pk.table),
					ancestors: [],
				}),
			},

			// Foreign key operations
			create_fk: {
				conflicts: ['create_fk', 'drop_constraint'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.fk.schema, statement.fk.table),
					ancestors: [],
				}),
			},

			// Constraint operations (FK drops / check drops)
			drop_constraint: {
				conflicts: ['drop_constraint', 'create_fk', 'create_check'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.schema, statement.table),
					ancestors: [],
				}),
			},

			// Check constraint operations
			create_check: {
				conflicts: ['create_check', 'drop_constraint'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.check.schema, statement.check.table),
					ancestors: [],
				}),
			},

			// View operations
			create_view: {
				conflicts: ['create_view', 'drop_view', 'rename_view', 'alter_view'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.view.schema, statement.view.name),
					ancestors: [],
				}),
			},
			drop_view: {
				conflicts: ['create_view', 'drop_view', 'rename_view', 'alter_view'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.schema, statement.name),
					ancestors: [],
				}),
			},
			rename_view: {
				conflicts: ['create_view', 'drop_view', 'rename_view', 'alter_view'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.schema, statement.from),
					ancestors: [],
				}),
			},
			alter_view: {
				conflicts: ['create_view', 'drop_view', 'rename_view', 'alter_view'],
				buildInfo: (statement) => ({
					primary: makeTarget(statement.view.schema, statement.view.name),
					ancestors: [],
				}),
			},
		};
	}

	protected override getImplicitAncestors(target: FootprintTarget): FootprintTarget[] {
		if (target.schema === '' || (target.objectName === '' && target.columnName === '')) {
			return [];
		}

		return [makeSchemaTarget(target.schema)];
	}

	protected override formatFootprintTarget(
		action: JsonStatement['type'],
		target: FootprintTarget,
	): string {
		return `${action};${target.schema};${target.objectName};${target.columnName}`;
	}

	protected override describeStatement(
		_statement: JsonStatement,
		info: StatementInfo,
	): string {
		if (info.action === 'create_schema' || info.action === 'drop_schema' || info.action === 'rename_schema') {
			return `${info.action}: ${info.primary.schema} database`;
		}

		if (this.schemaLevelActions.has(info.action)) {
			const container = info.primary.schema ? `${info.primary.schema} database` : 'database';
			return `${info.action}: ${info.primary.objectName} in ${container}`;
		}

		if (info.primary.columnName) {
			return `${info.action}: ${info.primary.columnName} on ${info.primary.objectName} table`;
		}

		return `${info.action} on ${info.primary.objectName} table`;
	}

	private viewLevelActions = new Set([
		'create_view',
		'drop_view',
		'alter_view',
		'rename_view',
	]);

	protected override describeStatementTarget(
		_statement: JsonStatement,
		info: StatementInfo,
	): ConflictTarget {
		if (info.action === 'create_schema' || info.action === 'drop_schema' || info.action === 'rename_schema') {
			return { kind: 'schema', name: info.primary.schema };
		}

		if (this.viewLevelActions.has(info.action)) {
			return { kind: 'view', name: info.primary.objectName, schema: info.primary.schema || undefined };
		}

		if (info.primary.columnName) {
			return {
				kind: 'column',
				name: info.primary.columnName,
				table: info.primary.objectName,
				schema: info.primary.schema || undefined,
			};
		}

		return { kind: 'table', name: info.primary.objectName, schema: info.primary.schema || undefined };
	}

	protected override getDrySnapshot(): MysqlSnapshot {
		return drySnapshot;
	}

	protected override async diffSnapshots(
		fromSnapshot: MysqlSnapshot,
		toSnapshot: MysqlSnapshot,
	): Promise<{ statements: JsonStatement[] }> {
		const fromDDL: MysqlDDL = createDDL();
		const toDDL: MysqlDDL = createDDL();

		fromDDL.entities.pushAll(fromSnapshot.ddl);
		toDDL.entities.pushAll(toSnapshot.ddl);

		const { statements } = await ddlDiffDry(fromDDL, toDDL, 'default');
		return { statements };
	}
}

export const mysqlCommutativity = new MysqlCommutativity();
