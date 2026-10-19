import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev only: serve /api/*.js the way Vercel does, so `npm run dev` works without the Vercel CLI.
const devApi = {
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use('/api', async (req, res, next) => {
      const url = new URL(req.url, 'http://x')
      const name = url.pathname.replace(/^\//, '').replace(/[^a-z-]/g, '')
      try {
        const mod = await server.ssrLoadModule(`/api/${name}.js`)
        res.status = (c) => { res.statusCode = c; return res }
        res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)) }
        req.query = Object.fromEntries(url.searchParams) // the handler also reads req.method and the POST body straight off req
        await mod.default(req, res)
      } catch (e) { next(e) }
    })
  },
}

export default defineConfig({ plugins: [react(), devApi] })
