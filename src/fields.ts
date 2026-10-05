export const fields = {
  password: /^.{12,256}$/u,
}

export function field(form: URLSearchParams, name: keyof typeof fields) {
  const value = form.get(name) ?? ''
  return fields[name].test(value) ? value : null
}
