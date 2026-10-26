# Stockroom - Inventory Management System

A mini full-stack web app for managing products: Flask + SQLite on the backend, vanilla HTML/CSS/JS on the frontend, talking over a JSON REST API.

## Setup

```bash
cd inventory-management-system
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:3000. The database (`database/inventory.db`) is created automatically and seeded with 5 sample products on first run only.

## Architecture

| Layer | File | Role |
|-------|------|------|
| API + DB | `app.py` | Flask routes, validation, `sqlite3` access (`sqlite3.Row`), `init_db()` |
| View | `templates/index.html` | Single-page layout: dashboard, controls, table, modal, toasts |
| Style | `static/css/style.css` | CSS variables, grid/flexbox, responsive breakpoint at 768px |
| Logic | `static/js/script.js` | Fetch API CRUD, rendering, debounced search, notifications |

Flow: the browser loads `/`, then `script.js` calls `/api/dashboard` and `/api/products`, renders the results, and re-fetches after every create, update, or delete.

## API

| Method | Endpoint | Description | Success | Errors |
|--------|----------|-------------|---------|--------|
| GET | `/` | Serves the SPA | 200 | - |
| GET | `/api/products?search=&category=` | List/filter products | 200 | 500 |
| GET | `/api/dashboard` | `total_products`, `total_stock`, `low_stock` (qty <= 5), `inventory_value` | 200 | 500 |
| POST | `/api/products` | Create a product | 201 | 400, 409 |
| PUT | `/api/products/<product_id>` | Update name, category, quantity, price | 200 | 400, 404 |
| DELETE | `/api/products/<product_id>` | Delete a product | 200 | 404 |

Example:

```bash
curl -X POST http://127.0.0.1:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"product_id":"P006","name":"Desk Lamp","category":"Home","quantity":10,"price":899}'
```

Errors return `{"error": "message"}`.

## Notes

- Status badges: quantity 0 is Out of Stock, 1-5 is Low Stock, above 5 is In Stock.
- All queries are parameterised, and table content is HTML-escaped on the client.
- Currency is displayed in INR; change the `Intl.NumberFormat` options in `script.js` to switch.
- To reset the data, stop the server and delete `database/inventory.db`.
