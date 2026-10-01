import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { hash } from './auth.ts'
import { load, save } from './data.ts'

const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
execFileSync('stty', ['-echo'], { stdio: 'inherit' })
const password = await prompt.question('Password: ')
prompt.close()
execFileSync('stty', ['echo'], { stdio: 'inherit' })
console.log()

if (!password) {
  console.error('Password is empty.')
  process.exit(1)
}

save({ ...load(), password: hash(password) })
