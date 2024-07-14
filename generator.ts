#!/usr/bin/env node
import dprint from 'dprint-node'
import pg from 'pg'
import cac from 'cac'
import path from 'node:path'
import fs from 'fs-extra'

import camelCase from 'camelcase'

const cli = cac('postgres-typebox')

cli.command('', 'Generate Typebox interfaces from Postgres database')
    .option('--uri <uri>', 'Postgres URI')
    .option('--output <output>', 'Output directory')
    .option('--camelCase', 'Use camelCase', { default: false })
    .option('--table <table>', 'Only this table, can be passed multiple times')

    .action(async (config) => {
        const isCamelCase = config.camelCase

        const client = new pg.Client({ connectionString: config.uri })
        await client.connect()

        const t = await client.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
        )
        const enums = await client.query(
            'SELECT t.typname AS enum_name, array_agg(e.enumlabel) AS values ' +
                'FROM pg_type t ' +
                'JOIN pg_enum e ON t.oid = e.enumtypid ' +
                "WHERE t.typtype = 'e' AND t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') " +
                'GROUP BY t.typname',
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

        console.log(enums.rows)

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
                ${en.values.join(', ')}
            }
            `
        }

        for (let table of tables) {
            console.log(`Processing ${table}...`)
            const d = await client.query(
                `SELECT * FROM information_schema.columns WHERE table_name = '${table}'`,
            )
            const describes = d.rows
            if (isCamelCase) table = camelCase(table, { pascalCase: true })
            content += `

            export const ${table} = Type.Object({`
            for (const desc of describes) {
                const field = isCamelCase
                    ? camelCase(desc.column_name)
                    : desc.column_name
                // console.log(desc)
                const type = getType(desc, `${table}.${field}`)
                content += `    ${field}: ${type},`
            }
            content += `\n  })

            export type ${camelCase(`${table}Type`)} = Static<typeof ${table}>`
        }

        const out = await dprint.format(config.output, content, {
            trailingCommas: 'always',
        })
        await fs.writeFileSync(config.output, out, 'utf8')

        await client.end()
    })

type Tables = string[]

cli.help().parse()

const isRequiredString = true
function nullable(type: string) {
    // if (isNullish) return `Type.Optional(Type.Union([${type}, Type.Null()]))`
    return `Type.Optional(${type})`
}

function getType(desc: Desc, field: string) {
    const type = desc.data_type.split(' ')[0]
    const isNull = desc.is_nullable === 'YES'
    switch (type) {
        case 'date':
        case 'datetime':
        case 'timestamp':
        case 'time':
        case 'year':
        case 'char':
        case 'character':
        case 'varchar':
        case 'text':
        case 'json':
        case 'decimal':
        case 'numeric':
            if (isNull) return nullable('Type.String()')
            else if (isRequiredString) return 'Type.String({ minLength: 1 })'
            else return 'Type.String()'
        case 'tinyint':
        case 'smallint':
        case 'int':
        case 'integer':
        case 'bigint':
        case 'float':
        case 'double':
        case 'real':
            const unsigned = desc.data_type.endsWith(' unsigned')
            const numberType = unsigned
                ? 'Type.Number({ minimum: 0 })'
                : 'Type.Number()'
            if (isNull) return nullable(numberType)
            else return numberType
        case 'boolean':
            if (isNull) return nullable('Type.Boolean()')
            else return 'Type.Boolean()'
        case 'USER-DEFINED':
            return `Type.Enum(${desc.udt_name})`
        // case 'enum':
        //     const value = desc.data_type
        //         .replace('enum(', '')
        //         .replace(')', '')
        //         .replaceAll(',', ', ')
        //     return `Type.Unsafe<${value.replaceAll(', ', ' | ')}>({ type: 'string', enum: [${value}] })`
        default:
            throw new Error(
                `Unknown type ${type} for ${field}\n${JSON.stringify(desc)}`,
            )
    }
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
