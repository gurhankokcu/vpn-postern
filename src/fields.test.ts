import assert from 'node:assert/strict'
import { test } from 'node:test'
import { field, fields } from './fields.ts'

test('a password is 12 to 256 characters on one line', () => {
  for (const password of ['x'.repeat(12), '🔑'.repeat(12), ' open sesame ', `<&'"> ß 🔑 and more`, 'x'.repeat(256), '🔑'.repeat(256)]) {
    assert.match(password, fields.password)
  }
  for (const password of ['', 'x'.repeat(11), '🔑'.repeat(11), 'open\nsesame twice', 'x'.repeat(257), '🔑'.repeat(257)]) {
    assert.doesNotMatch(password, fields.password)
  }
})

test('field returns the value when it follows its rule, else null', () => {
  assert.equal(field(new URLSearchParams('password=correct-horse'), 'password'), 'correct-horse')
  assert.equal(field(new URLSearchParams('password=correct%0Ahorse'), 'password'), null)
  assert.equal(field(new URLSearchParams(''), 'password'), null)
})
