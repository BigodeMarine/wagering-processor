import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
export default defineConfig({
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    dbName: process.env.DATABASE_NAME ?? 'wagering',
    user: process.env.DATABASE_USER ?? 'wagering',
    password: process.env.DATABASE_PASSWORD ?? 'wagering',
    extensions: [Migrator],
    entities: ['dist/**/*.entity.js'],
    entitiesTs: ['src/**/*.entity.ts'],
    migrations: {
        path: 'dist/migrations',
        pathTs: 'src/migrations',
        transactional: true,
        allOrNothing: true,
    },
    debug: process.env.NODE_ENV === 'development',
});
//# sourceMappingURL=mikro-orm.config.js.map