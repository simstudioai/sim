[![Stand With Ukraine](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/banner2-direct.svg)](https://stand-with-ukraine.pp.ua)

[![NPM Version](https://img.shields.io/npm/v/kysely?style=flat&label=latest)](https://github.com/kysely-org/kysely/releases/latest)
[![Tests](https://github.com/kysely-org/kysely/actions/workflows/test.yml/badge.svg)](https://github.com/kysely-org/kysely)
[![License](https://img.shields.io/github/license/kysely-org/kysely?style=flat)](https://github.com/kysely-org/kysely/blob/master/LICENSE)
[![Issues](https://img.shields.io/github/issues-closed/kysely-org/kysely?logo=github)](https://github.com/kysely-org/kysely/issues?q=is%3Aissue+is%3Aopen+sort%3Aupdated-desc)
[![Pull Requests](https://img.shields.io/github/issues-pr-closed/kysely-org/kysely?label=PRs&logo=github&style=flat)](https://github.com/kysely-org/kysely/pulls?q=is%3Apr+is%3Aopen+sort%3Aupdated-desc)
![GitHub contributors](https://img.shields.io/github/contributors/kysely-org/kysely)
[![Downloads](https://img.shields.io/npm/dw/kysely?logo=npm)](https://www.npmjs.com/package/kysely)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/kysely?label=size&logo=npm)](https://bundlephobia.com/package/kysely)

###### Join the discussion ⠀⠀⠀⠀⠀⠀⠀ 
[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=flat&logo=discord&logoColor=white)](https://discord.gg/xyBJ3GwvAm)
[![Bluesky](https://img.shields.io/badge/Bluesky-0285FF?style=flat&logo=Bluesky&logoColor=white)](https://bsky.app/profile/kysely.dev)

###### Get started
[![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=flat&logo=postgresql&logoColor=white)](https://kysely.dev/docs/getting-started?dialect=postgresql)
[![MySQL](https://img.shields.io/badge/mysql-4479A1.svg?style=flat&logo=mysql&logoColor=white)](https://kysely.dev/docs/getting-started?dialect=mysql)
[![MicrosoftSQLServer](https://img.shields.io/badge/Microsoft%20SQL%20Server-CC2927?style=flat&logo=microsoft%20sql%20server&logoColor=white)](https://kysely.dev/docs/getting-started?dialect=mssql)
[![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=flat&logo=sqlite&logoColor=white)](https://kysely.dev/docs/getting-started?dialect=sqlite)
& more!

# [Kysely](https://kysely.dev)

Kysely (pronounce “Key-Seh-Lee”) is a type-safe and autocompletion-friendly [TypeScript](https://www.typescriptlang.org/) [SQL](https://en.wikipedia.org/wiki/SQL) query builder.
Inspired by [Knex.js](http://knexjs.org/). Mainly developed for [Node.js](https://nodejs.org/en/) but also
runs on all other [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript) environments like [Deno](https://deno.com/), [Bun](https://bun.sh/), [Cloudflare Workers](https://workers.cloudflare.com/)
and web browsers.

![](https://github.com/kysely-org/kysely/blob/master/assets/demo.gif)

Kysely makes sure you only refer to tables and columns that are visible to the part of the query
you're writing. The result type only has the selected columns with correct types and aliases. As an
added bonus you get autocompletion for all that stuff.

As shown in the gif above, through the pure magic of modern TypeScript, Kysely is even able to parse
the alias given to `pet.name` and add the `pet_name` column to the result row type. Kysely is able to infer
column names, aliases and types from selected subqueries, joined subqueries, `with` statements and pretty
much anything you can think of.

Of course there are cases where things cannot be typed at compile time, and Kysely offers escape
hatches for these situations. See the [sql template tag](https://kysely-org.github.io/kysely-apidoc/interfaces/Sql.html)
and the [DynamicModule](https://kysely-org.github.io/kysely-apidoc/classes/DynamicModule.html#ref) for more info.

All API documentation is written in the typing files and you can simply hover over the module, class
or method you're using to see it in your IDE. The same documentation is also hosted [here](https://kysely-org.github.io/kysely-apidoc/).

If you start using Kysely and can't find something you'd want to use, please open an issue or join our
[Discord server](https://discord.gg/xyBJ3GwvAm).

# Getting started

Please visit our documentation site [kysely.dev](https://kysely.dev) to get started. We also have a comprehensive
API documentation hosted [here](https://kysely-org.github.io/kysely-apidoc/), but you can access the same
documentation in your IDE by hovering over a class/method/property/whatever.

# Core team

## Project leads

Responsible for project direction, API design, maintenance, code reviews, community support, documentation, and working on some of the most 
impactful/challenging things.

<table>
    <tbody>
        <tr>
            <td align="center">
                <a href="https://github.com/koskimas">
                    <img src="https://avatars.githubusercontent.com/u/846508?v=4?s=100" width="100px;" alt=""/>
                    <br />
                    Sami Koskimäki
                </a>
                <br />
                (the <a href="https://web.archive.org/web/20211203210043/https://www.jakso.me/blog/kysely-a-type-safe-sql-query-builder-for-typescript">author</a>)
            </td>
            <td align="center">
                <a href="https://github.com/igalklebanov">
                    <img src="https://avatars.githubusercontent.com/u/14938291?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Igal Klebanov
                </a>
                <br />
                (the <a href="https://github.com/kysely-org/kysely/pull/1414#issuecomment-2781281996">dynamo</a>)
            </td>
        </tr>
    </tbody>
</table>

## Honorable mentions

People who had special impact on the project and its growth.

<table>
    <tbody>
        <tr>
            <td align="center">
                <a href="https://github.com/fhur">
                    <img src="https://avatars.githubusercontent.com/u/6452323?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Fernando Hurtado
                </a>
                <br />
                (1st <a href="https://kysely.dev">docs</a>)
            </td>
            <td align="center">
                <a href="https://github.com/wirekang">
                    <img src="https://avatars.githubusercontent.com/u/43294688?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Wirekang
                </a>
                <br />
                (<a href="https://kyse.link">playground</a>)
            </td>
            <td align="center">
                <a href="https://github.com/tgriesser">
                    <img src="https://avatars.githubusercontent.com/u/154748?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Tim Griesser
                </a>
                <br />
                (<a href="https://knexjs.org/">Knex</a>)
            </td>
        </tr>
        <tr>
            <td align="center">
                <a href="https://github.com/RobinBlomberg">
                    <img src="https://avatars.githubusercontent.com/u/20827397?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Robin Blomberg
                </a>
                <br />
                (<a href="https://github.com/RobinBlomberg/kysely-codegen">codegen</a>)
            </td>
                        <td align="center">
                <a href="https://github.com/nexxeln">
                    <img src="https://avatars.githubusercontent.com/u/95541290?v=4&s=100" width="100px" alt="" />
                    <br />
                    Shoubhit Dash
                </a>
                <br />
                (prisma <a href="https://www.nexxel.dev/blog/typesafe-database">idea</a>)
            </td>
            <td align="center">
                <a href="https://github.com/nexxeln">
                    <img src="https://avatars.githubusercontent.com/u/3050355?v=4&s=100" width="100px" alt="" />
                    <br />
                    Valtýr Örn Kjartansson
                </a>
                <br />
                (prisma <a href="https://github.com/valtyr/prisma-kysely">impl</a>)
            </td>
        </tr>
        <tr>
            <td align="center">
                <a href="https://github.com/thdxr">
                    <img src="https://avatars.githubusercontent.com/u/826656?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Dax Raad
                </a>
                <br />
                (early <a href="https://thdxr.com/post/serverless-relational-showdown">adopter</a>)
            </td>
            <td align="center">
                <a href="https://github.com/t3dotgg">
                    <img src="https://avatars.githubusercontent.com/u/6751787?v=4&s=100" width="100px;" alt=""/>
                    <br />
                    Theo Browne
                </a>
                <br />
                (early <a href="https://discord.com/channels/966627436387266600/988912020558602331/993220628154961930">promoter</a>)
            </td>
            <td align="center">
                <a href="https://github.com/leerob">
                    <img src="https://avatars.githubusercontent.com/u/9113740?v=4&s=100" width="100px;" alt="" />
                    <br />
                    Lee Robinson
                </a>
                <br />
                (early <a href="https://x.com/leerob/status/1576929372811849730">promoter</a>)
            </td>
        </tr>
        <tr>
            <td align="center">
                <a href="https://github.com/ethanresnick">
                    <img src="https://avatars.githubusercontent.com/u/471894?v=4&s=100" width="100px" alt="" />
                    <br />
                    Ethan Resnick
                </a>
                <br />
                (timely <a href="https://github.com/kysely-org/kysely/issues/494">feedback</a>)
            </td>
            <td align="center">
                <a href="https://github.com/thetutlage">
                    <img src="https://avatars.githubusercontent.com/u/1706381?v=4&s=100" width="100px;" alt="" />
                    <br />
                    Harminder Virk
                </a>
                <br />
                (dope <a href="https://github.com/thetutlage/meta/discussions/8">writeup</a>)
            </td>
            <td align="center">
                <a href="https://github.com/elitan">
                    <img src="https://avatars.githubusercontent.com/u/331818?v=4&s=100" width="100px;" alt="" />
                    <br />
                    Johan Eliasson
                </a>
                <br />
                (<a href="https://eliasson.me/articles/crafting-the-perfect-t3-stack-my-journey-with-kysely-atlas-and-clerk">promoter</a>/<a href="https://www.youtube.com/watch?v=u2s39dRIpCM">educator</a>)
            </td>
        </tr>
        <!-- <tr>
            <td align="center">
                <a href="">
                    <img src="" width="100px;" alt="" />
                    <br />
                    Name
                </a>
                <br />
                (contribution)
            </td>
        </tr> -->
    </tbody>
</table>

## All contributors

<p align="center">
    <a href="https://github.com/kysely-org/kysely/graphs/contributors">
        <img src="https://contrib.rocks/image?repo=kysely-org/kysely" />
    </a>
    </br>
    <span>Want to contribute? Check out our <a href="./CONTRIBUTING.md" >contribution guidelines</a>.</span>
</p>

<p align="center">
    <a href="https://vercel.com/?utm_source=kysely&utm_campaign=oss">
        <img src="https://kysely.dev/img/powered-by-vercel.svg" alt="Powered by Vercel" />
    </a>
</p>
