#!/usr/bin/env node
import cac from 'cac'
import dprint from 'dprint-node'
import fs from 'fs-extra'
import pg from 'pg'

import camelCase from 'camelcase'

const cli = cac('postgres-typebox')

cli.command('', 'Generate Typebox interfaces from Postgres database')
    .option('--uri <uri>', 'Postgres URI')
    .option('--output <output>', 'Output directory')
    .option('--camelCase', 'Use camelCase', { default: false })
    .option('--table <table>', 'Only this table, can be passed multiple times')
    .option(
        '--schema <table>',
        'Only this schema, can be passed multiple times',
    )

    .action(async (config) => {
        const isCamelCase = config.camelCase

        const client = new pg.Client({ connectionString: config.uri })
        await client.connect()

        let schemas = ['public']
        if (typeof config.schema === 'string') {
            schemas = [config.schema]
        } else if (config.schema?.length) {
            schemas = config.schema
        }
        const t = await client.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'",
            [[schemas.map((schema) => schema)]],
        )
        const enums = await client.query(
            'SELECT t.typname AS enum_name, array_agg(e.enumlabel) AS values ' +
                'FROM pg_type t ' +
                'JOIN pg_enum e ON t.oid = e.enumtypid ' +
                "WHERE t.typtype = 'e' AND t.typnamespace IN (SELECT oid FROM pg_namespace WHERE nspname = ANY($1)) " +
                'GROUP BY t.typname',
            [[schemas.map((schema) => schema)]],
        )
        const enumsWithoutBrackets: {
            enum_name: string
            values: string[]
        }[] = enums.rows.map((row) => ({
            enum_name: row.enum_name,
            values: row.values.slice(1, -1).split(','),
        }))

        let tables = t.rows
            .map((row) => row.table_name)
            .filter((table) => !table.startsWith('knex_'))
            .sort() as Tables

        // console.log(enums.rows)

        const onlyTables =
            typeof config.table === 'string' ? [config.table] : config.table
        if (onlyTables && onlyTables.length)
            tables = tables.filter((table) => onlyTables.includes(table))

        if (config.ignore && config.ignore.length)
            tables = tables.filter((table) => !config.ignore.includes(table))

        let content = `import { Type } from '@sinclair/typebox'
        import type { Static } from '@sinclair/typebox'`

        for (const en of enumsWithoutBrackets) {
            content += `
            export enum ${en.enum_name} {
                ${[...new Set(en.values)].join(', ')}
            }
            `
        }
        const tableDescriptions = await Promise.all(
            tables.map(async (table) => {
                const d = await client.query(
                    `SELECT * FROM information_schema.columns WHERE table_name = '${table}'`,
                )
                const describes = d.rows
                return { describes, table }
            }),
        )

        content += tableDescriptions
            .map(({ describes, table }) => {
                console.log(`Processing ${table}...`)
                if (isCamelCase) table = camelCase(table, { pascalCase: true })
                const fields = unique(describes, (x) => x.column_name)
                    .map((desc) => {
                        const field = isCamelCase
                            ? camelCase(desc.column_name, { pascalCase: true })
                            : desc.column_name
                        const type = getType(desc, `${table}.${field}`)
                        return `    ${field}: ${type},`
                    })
                    .join('\n')
                const typeName = camelCase(`${table}Type`, { pascalCase: true })
                return `
                export const ${table} = Type.Object({
                ${fields}
                })

                export type ${typeName} = Static<typeof ${table}>`
            })
            .join('\n\n')

        const out = await dprint.format(config.output, content, {
            trailingCommas: 'always',
        })
        await fs.writeFileSync(config.output, out, 'utf8')

        if (errors.length) {
            for (const error of errors) {
                console.error('Error:', error.message)
            }
            process.exit(1)
        }
        await client.end()
    })

type Tables = string[]

cli.help().parse()

const isRequiredString = true
function nullable(type: string) {
    // if (isNullish) return `Type.Optional(Type.Union([${type}, Type.Null()]))`
    return `Type.Optional(${type})`
}
let errors: Error[] = []
function getType(desc: Desc, field: string) {
    const type = desc.data_type.split(' ')[0]
    const isNull = desc.is_nullable === 'YES'
    console.log(`${field}: ${type}`)
    let resultType = 'Type.Any()'
    switch (type) {
        case 'char':
        case 'character':
        case 'varchar':
        case 'text':
        case 'decimal':
        case 'uuid':
        case 'numeric':
            resultType = 'Type.String()'
            break
        case 'json':
        case 'jsonb':
            resultType = 'Type.Any()'
            break
        case 'date':
        case 'time':
        case 'year':
        case 'datetime':
        case 'timestamp':
            resultType = 'Type.Date()'
            break
        case 'tinyint':
        case 'smallint':
        case 'int':
        case 'integer':
        case 'bigint':
        case 'float':
        case 'double':
        case 'real':
            const unsigned = desc.data_type.endsWith(' unsigned')
            resultType = unsigned ? 'Type.Number({ minimum: 0 })' : 'Type.Number()'
            break
        case 'boolean':
            resultType = 'Type.Boolean()'
            break
        case 'USER-DEFINED':
            resultType = `Type.Enum(${desc.udt_name})`
            break
        case 'ARRAY':
            resultType = `Type.Array(Type.Any())`
            break
        case 'inet':
            resultType = `Type.String({ format: 'ipv4' })`
            break
        case 'macaddr':
            resultType = `Type.String({ format: 'mac' })`
            break
        case 'regrole':
        case 'regclass':
            resultType = `Type.String()`
            break
        default:
            errors.push(
                new Error(
                    `Unknown type ${type} for ${field} ${JSON.stringify(desc, null, 2)}`,
                ),
            )
    }
    return isNull ? nullable(resultType) : resultType
}

export type Desc = {
    table_catalog: string
    table_schema: string
    table_name: string
    column_name: string
    ordinal_position: number
    column_default: string
    is_nullable: string
    data_type: string
    character_maximum_length: number | null
    character_octet_length: number | null
    numeric_precision: number | null
    numeric_precision_radix: number | null
    numeric_scale: number | null
    datetime_precision: number | null
    interval_type: string | null
    interval_precision: number | null
    character_set_catalog: string | null
    character_set_schema: string | null
    character_set_name: string | null
    collation_catalog: string | null
    collation_schema: string | null
    collation_name: string | null
    domain_catalog: string | null
    domain_schema: string | null
    domain_name: string | null
    udt_catalog: string
    udt_schema: string
    udt_name: string
    scope_catalog: string | null
    scope_schema: string | null
    scope_name: string | null
    maximum_cardinality: number | null
    dtd_identifier: string
    is_self_referencing: string
    is_identity: string
    identity_generation: string | null
    identity_start: number | null
    identity_increment: number | null
    identity_maximum: number | null
    identity_minimum: number | null
    identity_cycle: string
    is_generated: string
    generation_expression: string | null
    is_updatable: string
}

function unique<T>(arr: T[], key: (item: T) => string) {
    return [
        ...arr
            .reduce((acc, item) => {
                const k = key(item)
                if (!acc.has(k)) acc.set(k, item)
                return acc
            }, new Map<string, T>())
            .values(),
    ]
}
