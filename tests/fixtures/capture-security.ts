// Synthetic data only. These payloads are never executed or used as real credentials.
export const nestedCapture = String.raw`{
  "event":"synthetic.event",
  "password":"synthetic-secret-root",
  "info":{
    "TOKEN":"synthetic-secret-token",
    "custom_credential":"synthetic-secret-custom",
    "visible":"kept",
    "nested":[
      {"Api_Key":"synthetic-secret-api","ok":"alpha"},
      [{"x-secret":"synthetic-secret-array","deep":{"cookie":"synthetic-secret-cookie","label":"beta"}}],
      {"authorization":{"value":"synthetic-secret-child"}}, null
    ]
  },
  "__proto__":{"password":"synthetic-secret-proto","safe":"prototype-data"},
  "token_hint":"safe"
}`;
export const nestedExpected = JSON.parse(String.raw`{
  "event":"synthetic.event",
  "info":{"visible":"kept","nested":[{"ok":"alpha"},[{"deep":{"label":"beta"}}],{},null]},
  "__proto__":{"safe":"prototype-data"},
  "token_hint":"safe"
}`) as unknown;
export const hostileHtml = '<!doctype html><script>globalThis.syntheticCaptureExecuted=true</script>'
  + '<img src="x" onerror="globalThis.syntheticCaptureExecuted=true">'
  + '<a href="javascript:globalThis.syntheticCaptureExecuted=true">synthetic</a> 😀';
