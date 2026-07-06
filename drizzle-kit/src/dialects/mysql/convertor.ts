import type { Simplify } from '../../utils';
import type { JsonStatement } from './statements';

// '' is the default database of the connection and renders unqualified
const key = (schema: string, name: string) => schema ? `\`${schema}\`.\`${name}\`` : `\`${name}\``;

export const convertor = <
	TType extends JsonStatement['type'],
	TStatement extends Extract<JsonStatement, { type: TType }>,
>(
	type: TType,
	convertor: (statement: Simplify<Omit<TStatement, 'type'>>) => string | string[],
) => {
	return {
		type,
		can: (st: JsonStatement) => {
			return st.type === type;
		},
		convert: convertor,
	};
};

// IF NOT EXISTS since the declared database can be the default database
// of the connection the migration ends up running on
const createSchema = convertor('create_schema', (st) => {
	return `CREATE DATABASE IF NOT EXISTS \`${st.name}\`;`;
});

const dropSchema = convertor('drop_schema', (st) => {
	return `DROP DATABASE \`${st.name}\`;`;
});

const renameSchema = convertor('rename_schema', (st) => {
	return `/*
 Renaming databases is not supported by MySQL, you'd have to create a new database,
 move all the tables from the old one to it with \`RENAME TABLE\` and drop the old database.

 Feel free to implement it as a custom migration (https://orm.drizzle.team/docs/kit-custom-migrations),
 we've generated new database creation statement for you:

 CREATE DATABASE \`${st.to.name}\`;
*/`;
});

const createTable = convertor('create_table', (st) => {
	const { schema, name, columns, pk, checks, indexes, fks } = st.table;

	const uniqueIndexes = indexes.filter((it) => it.isUnique);

	let statement = '';
	statement += `CREATE TABLE ${key(schema, name)} (\n`;

	for (let i = 0; i < columns.length; i++) {
		const column = columns[i];

		const isPK = pk && pk.columns.length === 1 && pk.columns[0] === column.name;
		const primaryKeyStatement = isPK ? ' PRIMARY KEY' : '';
		const notNullStatement = column.notNull && !isPK ? ' NOT NULL' : '';
		const defaultStatement = column.default !== null ? ` DEFAULT ${column.default}` : '';

		const onUpdateStatement = column.onUpdateNow
			? ` ON UPDATE CURRENT_TIMESTAMP` + `${column.onUpdateNowFsp ? '(' + column.onUpdateNowFsp + ')' : ''}`
			: '';

		const autoincrementStatement = column.autoIncrement && column.type !== 'serial'
			? ' AUTO_INCREMENT'
			: '';

		const generatedStatement = column.generated
			? ` GENERATED ALWAYS AS (${column.generated?.as}) ${column.generated?.type.toUpperCase()}`
			: '';

		const charSetStatement = column.charSet ? ` CHARACTER SET ${column.charSet}` : '';
		const collationStatement = column.collation ? ` COLLATE ${column.collation}` : '';

		statement += '\t'
			+ `\`${column.name}\` ${column.type}${charSetStatement}${collationStatement}${autoincrementStatement}${primaryKeyStatement}${generatedStatement}${notNullStatement}${defaultStatement}${onUpdateStatement}`;
		statement += i === columns.length - 1 ? '' : ',\n';
	}

	if (pk && (pk.columns.length > 1)) {
		statement += ',\n';
		// TIDB does not allow naming primary key constraints
		// under the hood mysql always names it `PRIMARY`
		statement += `\tCONSTRAINT PRIMARY KEY(\`${pk.columns.join(`\`,\``)}\`)`;
	}

	for (const unique of uniqueIndexes) {
		statement += ',\n';
		const uniqueString = unique.columns
			.map((it) => it.isExpression ? `${it.value}` : `\`${it.value}\``)
			.join(',');

		statement += `\tCONSTRAINT \`${unique.name}\` UNIQUE INDEX(${uniqueString})`;
	}

	// TODO remove from create_table
	for (const fk of fks) {
		statement += ',\n';
		statement += `\tCONSTRAINT \`${fk.name}\` FOREIGN KEY (\`${fk.columns.join('`,`')}\`) REFERENCES ${
			key(fk.schemaTo, fk.tableTo)
		}(\`${fk.columnsTo.join('`,`')}\`)`;
	}

	for (const check of checks) {
		statement += ',\n';
		statement += `\tCONSTRAINT \`${check.name}\` CHECK(${check.value})`;
	}

	statement += `\n);`;
	statement += `\n`;
	return statement;
});

const dropTable = convertor('drop_table', (st) => {
	return `DROP TABLE ${key(st.schema, st.table)};`;
});

const renameTable = convertor('rename_table', (st) => {
	return `RENAME TABLE ${key(st.schemaFrom, st.from)} TO ${key(st.schemaTo, st.to)};`;
});

const addColumn = convertor('add_column', (st) => {
	const { column, isPK } = st;
	const {
		name,
		type,
		notNull,
		table,
		onUpdateNow,
		autoIncrement,
		generated,
		onUpdateNowFsp,
	} = column;

	const defaultStatement = column.default !== null ? ` DEFAULT ${column.default}` : '';

	const notNullStatement = `${notNull ? ' NOT NULL' : ''}`;
	const primaryKeyStatement = `${isPK ? ' PRIMARY KEY' : ''}`;
	const autoincrementStatement = `${autoIncrement ? ' AUTO_INCREMENT' : ''}`;
	const onUpdateStatement = `${
		onUpdateNow ? ' ON UPDATE CURRENT_TIMESTAMP' + `${onUpdateNowFsp ? '(' + onUpdateNowFsp + ')' : ''}` : ''
	}`;

	const generatedStatement = generated
		? ` GENERATED ALWAYS AS (${generated?.as}) ${generated?.type.toUpperCase()}`
		: '';

	const charSetStatement = column.charSet ? ` CHARACTER SET ${column.charSet}` : '';
	const collationStatement = column.collation ? ` COLLATE ${column.collation}` : '';

	return `ALTER TABLE ${
		key(column.schema, table)
	} ADD \`${name}\` ${type}${charSetStatement}${collationStatement}${primaryKeyStatement}${autoincrementStatement}${defaultStatement}${generatedStatement}${notNullStatement}${onUpdateStatement};`;
});

const dropColumn = convertor('drop_column', (st) => {
	return `ALTER TABLE ${key(st.column.schema, st.column.table)} DROP COLUMN \`${st.column.name}\`;`;
});

const renameColumn = convertor('rename_column', (st) => {
	return `ALTER TABLE ${key(st.schema, st.table)} RENAME COLUMN \`${st.from}\` TO \`${st.to}\`;`;
});

const alterColumn = convertor('alter_column', (st) => {
	const { column, isPK, wasPK } = st;

	const defaultStatement = column.default !== null ? ` DEFAULT ${column.default}` : '';

	const notNullStatement = `${column.notNull ? ' NOT NULL' : ''}`;
	const primaryKeyStatement = `${isPK && !wasPK ? ' PRIMARY KEY' : ''}`;
	const autoincrementStatement = `${column.autoIncrement ? ' AUTO_INCREMENT' : ''}`;
	const onUpdateStatement = `${
		column.onUpdateNow
			? ' ON UPDATE CURRENT_TIMESTAMP' + `${column.onUpdateNowFsp ? '(' + column.onUpdateNowFsp + ')' : ''}`
			: ''
	}`;

	const generatedStatement = column.generated
		? ` GENERATED ALWAYS AS (${column.generated.as}) ${column.generated.type.toUpperCase()}`
		: '';

	const charSetStatement = column.charSet ? ` CHARACTER SET ${column.charSet}` : '';
	const collationStatement = column.collation ? ` COLLATE ${column.collation}` : '';

	return `ALTER TABLE ${
		key(column.schema, column.table)
	} MODIFY COLUMN \`${column.name}\` ${column.type}${charSetStatement}${collationStatement}${primaryKeyStatement}${autoincrementStatement}${defaultStatement}${generatedStatement}${notNullStatement}${onUpdateStatement};`;
});

const recreateColumn = convertor('recreate_column', (st) => {
	return [dropColumn.convert(st) as string, addColumn.convert(st) as string];
});

const createIndex = convertor('create_index', (st) => {
	// TODO: handle everything?
	const { name, table, columns, isUnique } = st.index;
	const indexPart = isUnique ? 'UNIQUE INDEX' : 'INDEX';

	const uniqueString = columns
		.map((it) => it.isExpression ? `${it.value}` : `\`${it.value}\``)
		.join(',');

	return `CREATE ${indexPart} \`${name}\` ON ${key(st.index.schema, table)} (${uniqueString});`;
});

const dropIndex = convertor('drop_index', (st) => {
	return `DROP INDEX \`${st.index.name}\` ON ${key(st.index.schema, st.index.table)};`;
});

const createFK = convertor('create_fk', (st) => {
	const {
		name,
		schema,
		table,
		columns,
		schemaTo,
		tableTo,
		columnsTo,
		onDelete,
		onUpdate,
	} = st.fk;
	const onDeleteStatement = onDelete !== 'NO ACTION' ? ` ON DELETE ${onDelete}` : '';
	const onUpdateStatement = onUpdate !== 'NO ACTION' ? ` ON UPDATE ${onUpdate}` : '';
	const fromColumnsString = columns.map((it) => `\`${it}\``).join(',');
	const toColumnsString = columnsTo.map((it) => `\`${it}\``).join(',');

	return `ALTER TABLE ${key(schema, table)} ADD CONSTRAINT \`${name}\` FOREIGN KEY (${fromColumnsString}) REFERENCES ${
		key(schemaTo, tableTo)
	}(${toColumnsString})${onDeleteStatement}${onUpdateStatement};`;
});

{
	// alter generated for column -> recreate
}

const createPK = convertor('create_pk', (st) => {
	return `ALTER TABLE ${key(st.pk.schema, st.pk.table)} ADD PRIMARY KEY (\`${st.pk.columns.join('`,`')}\`);`;
});

const dropPK = convertor('drop_pk', (st) => {
	return `ALTER TABLE ${key(st.pk.schema, st.pk.table)} DROP PRIMARY KEY;`;
});

const createCheck = convertor('create_check', (st) => {
	return `ALTER TABLE ${
		key(st.check.schema, st.check.table)
	} ADD CONSTRAINT \`${st.check.name}\` CHECK (${st.check.value});`;
});

const dropConstraint = convertor('drop_constraint', (st) => {
	const statements = [`ALTER TABLE ${key(st.schema, st.table)} DROP CONSTRAINT \`${st.constraint}\`;`];
	if (st.dropAutoIndex) statements.push(`DROP INDEX \`${st.constraint}\` ON ${key(st.schema, st.table)}`);
	return statements;
});

const createView = convertor('create_view', (st) => {
	const { definition, schema, name, algorithm, sqlSecurity, withCheckOption } = st.view;

	let statement = `CREATE `;
	statement += st.replace ? `OR REPLACE ` : ''; // NO replace was in the code
	statement += algorithm ? `ALGORITHM = ${algorithm} ` : '';
	statement += sqlSecurity ? `SQL SECURITY ${sqlSecurity} ` : '';
	statement += `VIEW ${key(schema, name)} AS (${definition})`;
	statement += withCheckOption ? ` WITH ${withCheckOption} CHECK OPTION` : '';

	statement += ';';

	return statement;
});

const dropView = convertor('drop_view', (st) => {
	return `DROP VIEW ${key(st.schema, st.name)};`;
});

const renameView = convertor('rename_view', (st) => {
	return `RENAME TABLE ${key(st.schema, st.from)} TO ${key(st.schema, st.to)};`;
});

const alterView = convertor('alter_view', (st) => {
	const { schema, name, definition, withCheckOption, algorithm, sqlSecurity } = st.view;

	let statement = `ALTER `;
	statement += `ALGORITHM = ${algorithm} `;
	statement += `SQL SECURITY ${sqlSecurity} `;
	statement += `VIEW ${key(schema, name)} AS ${definition}`;
	statement += withCheckOption ? ` WITH ${withCheckOption} CHECK OPTION` : '';
	statement += ';';

	return statement;
});

const convertors = [
	createSchema,
	dropSchema,
	renameSchema,
	createTable,
	dropTable,
	renameTable,
	addColumn,
	dropColumn,
	renameColumn,
	alterColumn,
	recreateColumn,
	createIndex,
	dropIndex,
	createFK,
	createPK,
	dropPK,
	createCheck,
	dropConstraint,
	createView,
	dropView,
	renameView,
	alterView,
];

export function fromJson(
	statements: JsonStatement[],
) {
	const grouped = statements
		.map((statement) => {
			const filtered = convertors.filter((it) => {
				return it.can(statement);
			});

			const convertor = filtered.length === 1 ? filtered[0] : undefined;
			if (!convertor) throw new Error(`No convertor for: ${statement.type} statement`);

			const sqlStatements = convertor.convert(statement as any);
			const statements = typeof sqlStatements === 'string' ? [sqlStatements] : sqlStatements;
			return { jsonStatement: statement, sqlStatements: statements };
		})
		.filter((it) => it !== null);

	const result = {
		sqlStatements: grouped.map((it) => it.sqlStatements).flat(),
		groupedStatements: grouped,
	};
	return result;
}
