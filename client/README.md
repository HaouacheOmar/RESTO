# RESTO — client

React + TypeScript (Vite) frontend. Design rules: [`../docs/SYSTEM_DESIGN.md`](../docs/SYSTEM_DESIGN.md).

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api, /media and /ws to Django on :8000
npm run build
npm run lint
```

Start the backend first (`cd ../server && python manage.py runserver`, after `seed_demo` for demo data).
