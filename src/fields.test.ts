import assert from 'node:assert/strict'
import { test } from 'node:test'
import { field, fields } from './fields.ts'

test('a node name is 1 to 32 letters, digits, - or _, with single spaces between words', () => {
  for (const name of ['a', 'home', 'Mum and Dad Pi', 'work-pi_2', 'x'.repeat(32)]) {
    assert.match(name, fields.nodeName)
  }
  for (const name of ['', ' ', ' home', 'home ', 'Mum  Dad', "Mum & Dad's <Pi>", 'café', 'home\n', 'x'.repeat(33)]) {
    assert.doesNotMatch(name, fields.nodeName)
  }
})

test('a device name is 1 to 32 letters, digits, - or _, with no spaces', () => {
  for (const name of ['a', 'mum', 'Dads-Phone', 'tablet_2', 'x'.repeat(32)]) {
    assert.match(name, fields.deviceName)
  }
  for (const name of ['', ' ', 'mum phone', ' mum', 'mum ', '../mum', 'mum.conf', 'café', 'mum\n', 'x'.repeat(33)]) {
    assert.doesNotMatch(name, fields.deviceName)
  }
})

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
