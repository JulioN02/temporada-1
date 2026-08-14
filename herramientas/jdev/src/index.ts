#!/usr/bin/env node
import { buildProgram } from './cli/registry.ts'
import { installEpipeGuard } from './cli/exit.ts'

installEpipeGuard()
buildProgram().parse(process.argv)
