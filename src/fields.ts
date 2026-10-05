export const fields = {
  nodeName: /^(?=.{1,32}$)[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/,
  password: /^.{12,256}$/u,
}

export function field(form: URLSearchParams, name: keyof typeof fields) {
  const value = form.get(name) ?? ''
  return fields[name].test(value) ? value : null
}
