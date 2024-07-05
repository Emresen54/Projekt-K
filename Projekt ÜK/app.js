const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

const app = express();
const port = 3000;
const secretKey = 'your_secret_key';

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads')); 
app.use(express.static('src'));


let db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to database');
  }
});

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, categoryId INTEGER, image TEXT, FOREIGN KEY(categoryId) REFERENCES categories(id))");
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT)");
  
  const hashedAdminPassword = bcrypt.hashSync('admin', 10);
  db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?) ON CONFLICT(username) DO NOTHING", ['admin', hashedAdminPassword, 'admin']);
});


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'src/uploads/');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});


const upload = multer({ storage: storage });

app.post('/register', (req, res) => {
  const { username, password, role = 'user' } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hashedPassword, role], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(201).json({ id: this.lastID, username, role });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!user || !bcrypt.compareSync(password, user.password)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign({ username: user.username, role: user.role }, secretKey);
    res.json({ token });
  });
});

app.post('/reset-password', (req, res) => {
  const { username, newPassword } = req.body;
  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.run("UPDATE users SET password = ? WHERE username = ?", [hashedPassword, username], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Password reset successfully' });
  });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/categories', (req, res) => {
  db.all("SELECT * FROM categories", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/categories', (req, res) => {
  const { name } = req.body;
  db.run("INSERT INTO categories (name) VALUES (?)", [name], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(201).json({ id: this.lastID, name });
  });
});

app.get('/categories/:id', (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM categories WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row || { message: 'Category not found' });
  });
});

app.put('/categories/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  db.run("UPDATE categories SET name = ? WHERE id = ?", [name, id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id, name });
  });
});

app.delete('/categories/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM categories WHERE id = ?", [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Category deleted' });
  });
});

app.get('/products', (req, res) => {
  let query = `
    SELECT p.*, c.name as categoryName
    FROM products p
    LEFT JOIN categories c ON p.categoryId = c.id
  `;
  const params = [];

  if (req.query.category) {
    query += " WHERE c.name = ?";
    params.push(req.query.category);
  } else if (req.query.search) {
    query += " WHERE p.name LIKE ?";
    params.push(`%${req.query.search}%`);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/products', upload.single('image'), (req, res) => {
  const { name, price, categoryId } = req.body;
  const image = req.file ? req.file.filename : '';

  db.run("INSERT INTO products (name, price, categoryId, image) VALUES (?, ?, ?, ?)", [name, price, categoryId, image], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(201).json({ id: this.lastID, name, price, categoryId, image });
  });
});

app.get('/products/:id', (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT p.*, c.name as categoryName
    FROM products p
    LEFT JOIN categories c ON p.categoryId = c.id
    WHERE p.id = ?
  `, [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row || { message: 'Product not found' });
  });
});

app.put('/products/:id', upload.single('image'), (req, res) => {
  const { id } = req.params;
  const { name, price, categoryId } = req.body;
  const image = req.file ? req.file.filename : '';

  db.run("UPDATE products SET name = ?, price = ?, categoryId = ?, image = ? WHERE id = ?", [name, price, categoryId, image, id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id, name, price, categoryId, image });
  });
});

app.delete('/products/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM products WHERE id = ?", [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Product deleted' });
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
