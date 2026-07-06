import { foreignKey, int, mysqlSchema, mysqlTable } from 'drizzle-orm/mysql-core';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { diff, prepareTestDatabase, push, TestDatabase } from './mocks';

// @vitest-environment-options {"max-concurrency":1}
let _: TestDatabase;
let db: TestDatabase['db'];

beforeAll(async () => {
	_ = await prepareTestDatabase();
	db = _.db;
});

afterAll(async () => {
	await _.close();
});

beforeEach(async () => {
	await _.clear();
});

// MySQL schemas are databases: https://dev.mysql.com/doc/refman/8.4/en/create-database.html
test('add schema #1', async () => {
	const to = {
		devSchema: mysqlSchema('dev'),
	};

	const { sqlStatements: st } = await diff({}, to, []);
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['CREATE DATABASE IF NOT EXISTS `dev`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('add schema #2', async () => {
	const from = {
		devSchema: mysqlSchema('dev'),
	};
	const to = {
		devSchema: mysqlSchema('dev'),
		devSchema2: mysqlSchema('dev2'),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['CREATE DATABASE IF NOT EXISTS `dev2`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

// a schema declared with the connection's default database name is a no-op for push
test('add schema #3', async () => {
	const to = {
		devSchema: mysqlSchema('drizzle'),
	};

	const { sqlStatements: pst } = await push({ db, to });

	expect(pst).toStrictEqual([]);
});

test('delete schema #1', async () => {
	const from = {
		devSchema: mysqlSchema('dev'),
	};

	const { sqlStatements: st } = await diff(from, {}, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to: {} });

	const st0: string[] = ['DROP DATABASE `dev`;'];
	expect(st).toStrictEqual(st0);
	// push only introspects the databases the drizzle schema declares,
	// removing a schema from the drizzle schema hides it from push
	expect(pst).toStrictEqual([]);
});

test('delete schema #2', async () => {
	const from = {
		devSchema: mysqlSchema('dev'),
		devSchema2: mysqlSchema('dev2'),
	};
	const to = {
		devSchema: mysqlSchema('dev'),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	const st0: string[] = ['DROP DATABASE `dev2`;'];
	expect(st).toStrictEqual(st0);
});

test('rename schema #1', async () => {
	const from = {
		devSchema: mysqlSchema('dev'),
	};
	const to = {
		devSchema2: mysqlSchema('dev2'),
	};

	const renames = ['dev->dev2'];
	const { sqlStatements: st } = await diff(from, to, renames);

	// MySQL can't rename databases, a warning comment is generated
	expect(st.length).toBe(1);
	expect(st[0]).toContain('Renaming databases is not supported by MySQL');
});

test('rename schema #2', async () => {
	const from = {
		devSchema: mysqlSchema('dev'),
		devSchema1: mysqlSchema('dev1'),
	};
	const to = {
		devSchema: mysqlSchema('dev'),
		devSchema2: mysqlSchema('dev2'),
	};

	const renames = ['dev1->dev2'];
	const { sqlStatements: st } = await diff(from, to, renames);

	expect(st.length).toBe(1);
	expect(st[0]).toContain('Renaming databases is not supported by MySQL');
});

test('add table to schema #1', async () => {
	const dev = mysqlSchema('dev');
	const from = {};
	const to = {
		dev,
		users: dev.table('users', { id: int() }),
	};

	const { sqlStatements: st } = await diff(from, to, []);
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['CREATE DATABASE IF NOT EXISTS `dev`;', 'CREATE TABLE `dev`.`users` (\n\t`id` int\n);\n'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('add table to schema #2', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev };
	const to = {
		dev,
		users: dev.table('users', { id: int() }),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['CREATE TABLE `dev`.`users` (\n\t`id` int\n);\n'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

// same-named tables in different databases are distinct
test('add table to schema #3', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev };
	const to = {
		dev,
		usersInDev: dev.table('users', { id: int() }),
		users: mysqlTable('users', { id: int() }),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = [
		'CREATE TABLE `users` (\n\t`id` int\n);\n',
		'CREATE TABLE `dev`.`users` (\n\t`id` int\n);\n',
	];
	expect(st.slice().sort()).toStrictEqual(st0.slice().sort());
	expect(pst.slice().sort()).toStrictEqual(st0.slice().sort());
});

test('remove table from schema #1', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev, users: dev.table('users', { id: int() }) };
	const to = {
		dev,
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['DROP TABLE `dev`.`users`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('remove table from schema #2', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev, users: dev.table('users', { id: int() }) };
	const to = {};

	const { sqlStatements: st } = await diff(from, to, []);

	const st0: string[] = ['DROP TABLE `dev`.`users`;', 'DROP DATABASE `dev`;'];
	expect(st).toStrictEqual(st0);
});

test('rename table in schema #1', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev, users: dev.table('users', { id: int() }) };
	const to = { dev, users2: dev.table('users2', { id: int() }) };

	const renames = ['dev.users->dev.users2'];
	const { sqlStatements: st } = await diff(from, to, renames);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to, renames });

	const st0: string[] = ['RENAME TABLE `dev`.`users` TO `dev`.`users2`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('move table between schemas #1', async () => {
	const dev = mysqlSchema('dev');
	const dev2 = mysqlSchema('dev2');
	const from = { dev, dev2, users: dev.table('users', { id: int() }) };
	const to = { dev, dev2, users: dev2.table('users', { id: int() }) };

	const renames = ['dev.users->dev2.users'];
	const { sqlStatements: st } = await diff(from, to, renames);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to, renames });

	const st0: string[] = ['RENAME TABLE `dev`.`users` TO `dev2`.`users`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('move table from default database to schema #1', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev, users: mysqlTable('users', { id: int() }) };
	const to = { dev, users: dev.table('users', { id: int() }) };

	const renames = ['users->dev.users'];
	const { sqlStatements: st } = await diff(from, to, renames);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to, renames });

	const st0: string[] = ['RENAME TABLE `users` TO `dev`.`users`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('alter table in schema #1', async () => {
	const dev = mysqlSchema('dev');
	const from = { dev, users: dev.table('users', { id: int() }) };
	const to = { dev, users: dev.table('users', { id: int(), name: int() }) };

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['ALTER TABLE `dev`.`users` ADD `name` int;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

test('cross database foreign key #1', async () => {
	const dev = mysqlSchema('dev');
	const users = dev.table('users', { id: int().primaryKey() });
	const from = { dev };
	const to = {
		dev,
		users,
		posts: mysqlTable('posts', {
			id: int().primaryKey(),
			userId: int('user_id').references(() => users.id),
		}),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = [
		'CREATE TABLE `posts` (\n\t`id` int PRIMARY KEY,\n\t`user_id` int\n);\n',
		'CREATE TABLE `dev`.`users` (\n\t`id` int PRIMARY KEY\n);\n',
		'ALTER TABLE `posts` ADD CONSTRAINT `posts_user_id_users_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `dev`.`users`(`id`);',
	];
	expect(st.slice().sort()).toStrictEqual(st0.slice().sort());
	expect(pst.slice().sort()).toStrictEqual(st0.slice().sort());
});

test('view in schema #1', async () => {
	const dev = mysqlSchema('dev');
	const users = dev.table('users', { id: int() });
	const from = { dev, users };
	const to = {
		dev,
		users,
		view: dev.view('users_view').as((qb) => qb.select().from(users)),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = [
		'CREATE ALGORITHM = undefined SQL SECURITY definer VIEW `dev`.`users_view` AS (select `id` from `dev`.`users`);',
	];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

// a table of a non-exported mysqlSchema() declares its database too
test('add table of non-exported schema #1', async () => {
	const dev = mysqlSchema('dev');
	const to = {
		users: dev.table('users', { id: int() }),
	};

	const { sqlStatements: st } = await diff({}, to, []);
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = ['CREATE DATABASE IF NOT EXISTS `dev`;', 'CREATE TABLE `dev`.`users` (\n\t`id` int\n);\n'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

// renaming a table must not touch same-named foreign keys of other databases
test('rename table with same-shaped fk in another database #1', async () => {
	const analytics = mysqlSchema('analytics');
	const usersInAnalytics = analytics.table('users2', { id: int().primaryKey() });
	const postsInAnalytics = analytics.table('posts', {
		id: int().primaryKey(),
		authorId: int('author_id').references(() => usersInAnalytics.id),
	});

	const users = mysqlTable('users', { id: int().primaryKey() });
	const posts = mysqlTable('posts', {
		id: int().primaryKey(),
		authorId: int('author_id').references(() => users.id),
	});

	const users2 = mysqlTable('users2', { id: int().primaryKey() });
	const posts2 = mysqlTable('posts', {
		id: int().primaryKey(),
		authorId: int('author_id').references(() => users2.id),
	});

	const from = { analytics, usersInAnalytics, postsInAnalytics, users, posts };
	const to = { analytics, usersInAnalytics, postsInAnalytics, users: users2, posts: posts2 };

	const renames = ['users->users2'];
	const { sqlStatements: st } = await diff(from, to, renames);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to, renames });

	const st0: string[] = ['RENAME TABLE `users` TO `users2`;'];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

// repointing an explicitly named fk to a same-named table of another database recreates it
test('repoint fk to another database #1', async () => {
	const dev = mysqlSchema('dev');
	const dev2 = mysqlSchema('dev2');
	const usersInDev = dev.table('users', { id: int().primaryKey() });
	const usersInDev2 = dev2.table('users', { id: int().primaryKey() });

	const from = {
		dev,
		dev2,
		usersInDev,
		usersInDev2,
		posts: dev.table('posts', { id: int().primaryKey(), uid: int() }, (t) => [
			foreignKey({ name: 'posts_uid_fk', columns: [t.uid], foreignColumns: [usersInDev.id] }),
		]),
	};
	const to = {
		dev,
		dev2,
		usersInDev,
		usersInDev2,
		posts: dev.table('posts', { id: int().primaryKey(), uid: int() }, (t) => [
			foreignKey({ name: 'posts_uid_fk', columns: [t.uid], foreignColumns: [usersInDev2.id] }),
		]),
	};

	const { sqlStatements: st } = await diff(from, to, []);

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to });

	const st0: string[] = [
		'ALTER TABLE `dev`.`posts` DROP CONSTRAINT `posts_uid_fk`;',
		'ALTER TABLE `dev`.`posts` ADD CONSTRAINT `posts_uid_fk` FOREIGN KEY (`uid`) REFERENCES `dev2`.`users`(`id`);',
	];
	expect(st).toStrictEqual(st0);
	expect(pst).toStrictEqual(st0);
});

// MySQL resolves unqualified references against the table's own database, a table
// of another database can not reference a table of the connection's default database
test('cross database foreign key into default database #1', async () => {
	const dev = mysqlSchema('dev');
	const users = mysqlTable('users', { id: int().primaryKey() });
	const to = {
		dev,
		users,
		posts: dev.table('posts', {
			id: int().primaryKey(),
			userId: int('user_id').references(() => users.id),
		}),
	};

	const { suggestion } = await diff({}, to, []);
	expect(suggestion.errors.length).toBe(1);
	expect(suggestion.errors[0]).toContain('MySQL can not reference the default database');

	await expect(push({ db, to })).rejects.toThrowError();
});

// push only introspects the databases the drizzle schema declares, so a database
// rename is just a creation of the new database — the old one stays invisible
test('rename schema on push #1', async () => {
	const from = { dev: mysqlSchema('dev') };
	const to = { dev2: mysqlSchema('dev2') };

	await push({ db, to: from });
	const { sqlStatements: pst } = await push({ db, to, renames: ['dev->dev2'] });

	expect(pst).toStrictEqual(['CREATE DATABASE IF NOT EXISTS `dev2`;']);
});
