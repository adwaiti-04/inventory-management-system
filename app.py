"""Inventory Management System - Flask + SQLite REST API."""
import os
import sqlite3

from flask import Flask, jsonify, render_template, request

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "database", "inventory.db")

app = Flask(__name__)

SEED_PRODUCTS = [
    ("P001", "Laptop", "Electronics", 12, 55000.00),
    ("P002", "Wireless Mouse", "Accessories", 40, 799.00),
    ("P003", "Keyboard", "Accessories", 4, 1499.00),
    ("P004", "USB Cable", "Accessories", 0, 249.00),
    ("P005", "Water Bottle", "Home", 25, 399.00),
]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK(quantity >= 0),
                price REAL NOT NULL CHECK(price >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            conn.executemany(
                "INSERT OR IGNORE INTO products (product_id, name, category, quantity, price) "
                "VALUES (?, ?, ?, ?, ?)",
                SEED_PRODUCTS,
            )
        conn.commit()
    finally:
        conn.close()


def error(message, status):
    return jsonify({"error": message}), status


def parse_fields(data, need_id):
    """Validate payload. Returns (cleaned_dict, error_message)."""
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object."
    cleaned = {}
    keys = ["name", "category"] + (["product_id"] if need_id else [])
    for key in keys:
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            return None, f"'{key}' is required and cannot be empty."
        cleaned[key] = value.strip()
    try:
        qty = data.get("quantity")
        if isinstance(qty, bool) or qty is None or str(qty).strip() == "":
            raise ValueError
        qty_f = float(qty)
        if qty_f != int(qty_f):
            return None, "'quantity' must be a whole number."
        cleaned["quantity"] = int(qty_f)
    except (ValueError, TypeError):
        return None, "'quantity' must be a valid number."
    try:
        price = data.get("price")
        if isinstance(price, bool) or price is None or str(price).strip() == "":
            raise ValueError
        cleaned["price"] = float(price)
    except (ValueError, TypeError):
        return None, "'price' must be a valid number."
    if cleaned["quantity"] < 0:
        return None, "'quantity' must be 0 or greater."
    if cleaned["price"] < 0:
        return None, "'price' must be 0 or greater."
    return cleaned, None


def row_to_dict(row):
    return {k: row[k] for k in row.keys()}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/products", methods=["GET"])
def list_products():
    search = request.args.get("search", "").strip()
    category = request.args.get("category", "").strip()
    sql, params = "SELECT * FROM products WHERE 1=1", []
    if search:
        sql += " AND (product_id LIKE ? OR name LIKE ? OR category LIKE ?)"
        like = f"%{search}%"
        params += [like, like, like]
    if category:
        sql += " AND category = ?"
        params.append(category)
    sql += " ORDER BY id DESC"
    conn = get_db()
    try:
        rows = conn.execute(sql, params).fetchall()
        cats = conn.execute("SELECT DISTINCT category FROM products ORDER BY category").fetchall()
    finally:
        conn.close()
    return jsonify({
        "products": [row_to_dict(r) for r in rows],
        "categories": [c["category"] for c in cats],
    }), 200


@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    conn = get_db()
    try:
        row = conn.execute(
            """
            SELECT COUNT(*) AS total_products,
                   COALESCE(SUM(quantity), 0) AS total_stock,
                   COALESCE(SUM(CASE WHEN quantity <= 5 THEN 1 ELSE 0 END), 0) AS low_stock,
                   COALESCE(SUM(quantity * price), 0) AS inventory_value
            FROM products
            """
        ).fetchone()
    finally:
        conn.close()
    return jsonify(row_to_dict(row)), 200


@app.route("/api/products", methods=["POST"])
def create_product():
    data, err = parse_fields(request.get_json(silent=True), need_id=True)
    if err:
        return error(err, 400)
    conn = get_db()
    try:
        if conn.execute("SELECT 1 FROM products WHERE product_id = ?", (data["product_id"],)).fetchone():
            return error(f"Product ID '{data['product_id']}' already exists.", 409)
        conn.execute(
            "INSERT INTO products (product_id, name, category, quantity, price) VALUES (?, ?, ?, ?, ?)",
            (data["product_id"], data["name"], data["category"], data["quantity"], data["price"]),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM products WHERE product_id = ?", (data["product_id"],)).fetchone()
        return jsonify({"message": "Product created.", "product": row_to_dict(row)}), 201
    except sqlite3.IntegrityError as exc:
        return error(f"Database constraint failed: {exc}", 400)
    finally:
        conn.close()


@app.route("/api/products/<product_id>", methods=["PUT"])
def update_product(product_id):
    data, err = parse_fields(request.get_json(silent=True), need_id=False)
    if err:
        return error(err, 400)
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE products SET name = ?, category = ?, quantity = ?, price = ?, "
            "updated_at = CURRENT_TIMESTAMP WHERE product_id = ?",
            (data["name"], data["category"], data["quantity"], data["price"], product_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return error(f"Product '{product_id}' not found.", 404)
        row = conn.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
        return jsonify({"message": "Product updated.", "product": row_to_dict(row)}), 200
    except sqlite3.IntegrityError as exc:
        return error(f"Database constraint failed: {exc}", 400)
    finally:
        conn.close()


@app.route("/api/products/<product_id>", methods=["DELETE"])
def delete_product(product_id):
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM products WHERE product_id = ?", (product_id,))
        conn.commit()
        if cur.rowcount == 0:
            return error(f"Product '{product_id}' not found.", 404)
        return jsonify({"message": "Product deleted."}), 200
    finally:
        conn.close()


@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return error("Endpoint not found.", 404)
    return "Page not found", 404


@app.errorhandler(500)
def server_error(_e):
    return error("Internal server error.", 500)


init_db()

if __name__ == "__main__":
    app.run(debug=True)
