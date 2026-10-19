// Carrying your ESPN connection from the laptop to the phone.
//
// iOS Safari has no DevTools, so there is no way to read a cookie on the phone. The laptop
// encrypts the connection with a six-digit code you pick and puts the ciphertext in a link's
// fragment — the part after "#", which browsers never send to any server. You hand the link
// to yourself (AirDrop, Messages), type the six digits on the phone, and it decrypts there.
//
// Nothing is stored anywhere. No server sees the link, the code travels separately, and a
// link on its own is useless without it.

const ITERATIONS = 310000 // OWASP's 2023 floor for PBKDF2-SHA256, and a six-digit code needs it
const enc = new TextEncoder()
const dec = new TextDecoder()

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function keyFrom(code, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

// A six-digit code, read aloud or typed, not generated to be remembered for long.
export const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')

export async function pack(payload, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFrom(code, salt)
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))))
  const out = new Uint8Array(salt.length + iv.length + body.length)
  out.set(salt, 0); out.set(iv, salt.length); out.set(body, salt.length + iv.length)
  return b64url(out)
}

export async function unpack(token, code) {
  const raw = unb64url(token)
  const key = await keyFrom(code, raw.slice(0, 16))
  // A wrong code fails here, in the tag check, rather than returning plausible rubbish.
  const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(16, 28) }, key, raw.slice(28))
  return JSON.parse(dec.decode(body))
}

export const linkFor = (token) => `${location.origin}/#link=${token}`
export const tokenInUrl = () => (location.hash.startsWith('#link=') ? location.hash.slice(6) : null)
// Take the token out of the address bar once it is used, so a shared screenshot is harmless.
export const clearToken = () => history.replaceState(null, '', `${location.pathname}${location.search}#league`)
