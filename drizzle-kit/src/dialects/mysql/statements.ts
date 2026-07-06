import type { Simplify } from '../../utils';
import type {
	CheckConstraint,
	Column,
	DiffEntities,
	ForeignKey,
	Index,
	PrimaryKey,
	Schema,
	TableFull,
	View,
} from './ddl';

export interface CreateSchema {
	type: 'create_schema';
	name: string;
}

export interface DropSchema {
	type: 'drop_schema';
	name: string;
}

export interface RenameSchema {
	type: 'rename_schema';
	from: Schema;
	to: Schema;
}

export interface CreateTable {
	type: 'create_table';
	table: TableFull;
}

export interface DropTable {
	type: 'drop_table';
	schema: string;
	table: string;
}

// also handles moving tables between databases: `RENAME TABLE `db1`.`t` TO `db2`.`t``
export interface RenameTable {
	type: 'rename_table';
	schemaFrom: string;
	from: string;
	schemaTo: string;
	to: string;
}

export interface AddColumn {
	type: 'add_column';
	column: Column;
	isPK: boolean;
}

export interface DropColumn {
	type: 'drop_column';
	column: Column;
}

export interface RenameColumn {
	type: 'rename_column';
	schema: string;
	table: string;
	from: string;
	to: string;
}

export interface AlterColumn {
	type: 'alter_column';
	diff: DiffEntities['columns'];
	column: Column;
	isPK: boolean;
	wasPK: boolean;
	origin: {
		column: string;
		schema: string;
		table: string;
	};
}

export interface RecreateColumn {
	type: 'recreate_column';
	column: Column;
	isPK: boolean;
	diff: DiffEntities['columns'];
}

export interface CreateIndex {
	type: 'create_index';
	index: Index;
}

export interface DropIndex {
	type: 'drop_index';
	index: Index;
}

export interface CreateFK {
	type: 'create_fk';
	fk: ForeignKey;
	cause?: 'alter_pk';
}

export interface CreatePK {
	type: 'create_pk';
	pk: PrimaryKey;
}

export interface CreatePK {
	type: 'create_pk';
	pk: PrimaryKey;
}

export interface DropPK {
	type: 'drop_pk';
	pk: PrimaryKey;
}

export interface DropConstraint {
	type: 'drop_constraint';
	schema: string;
	table: string;
	constraint: string;
	dropAutoIndex: boolean;
}

export interface CreateView {
	type: 'create_view';
	view: View;
	replace: boolean;
}

export interface DropView {
	type: 'drop_view';
	schema: string;
	name: string;
}

// views can't be moved between databases with `RENAME TABLE`, renames are same-database only
export interface RenameView {
	type: 'rename_view';
	schema: string;
	from: string;
	to: string;
}

export interface AlterView {
	type: 'alter_view';
	diff: DiffEntities['views'];
	view: View;
}

export interface CreateCheck {
	type: 'create_check';
	check: CheckConstraint;
}

export type JsonStatement =
	| CreateSchema
	| DropSchema
	| RenameSchema
	| CreateTable
	| DropTable
	| RenameTable
	| AddColumn
	| DropColumn
	| RenameColumn
	| AlterColumn
	| RecreateColumn
	| CreateIndex
	| DropIndex
	| CreateFK
	| CreatePK
	| DropPK
	| CreateView
	| DropView
	| RenameView
	| AlterView
	| DropConstraint
	| CreateCheck;

export const prepareStatement = <
	TType extends JsonStatement['type'],
	TStatement extends Extract<JsonStatement, { type: TType }>,
>(
	type: TType,
	args: Omit<TStatement, 'type'>,
): Simplify<TStatement> => {
	return {
		type,
		...args,
	} as TStatement;
};
