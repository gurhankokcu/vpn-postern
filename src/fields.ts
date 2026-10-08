export const fields = {
  name: /^[A-Za-z0-9_-]{1,32}$/,
  password: /^.{12,256}$/u,
  port: /^[0-9]{1,5}$/,
}

export function field(form: URLSearchParams, name: keyof typeof fields) {
  const value = form.get(name) ?? ''
  return fields[name].test(value) ? value : null
}
