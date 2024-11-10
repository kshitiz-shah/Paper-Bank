const express = require('express');
const multer = require('multer');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const port = 3000;

// Initialize SQLite database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to the database.');
  }
});

// Create table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      course TEXT NOT NULL,
      college TEXT NOT NULL,
      year TEXT NOT NULL,
      subject TEXT NOT NULL
    )
  `, (err) => {
    if (err) console.error('Error creating table:', err.message);
  });
});

// Set up multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + file.originalname;
    cb(null, uniqueSuffix);
  }
});

const upload = multer({ storage: storage });

// Middleware for static files
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route for main interface page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'interface.html'));
});

// Route for file upload page
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});

// Route for file view page
app.get('/view', (req, res) => {
  res.sendFile(path.join(__dirname, 'view.html'));
});

// Endpoint to upload a file with metadata
app.post('/upload', upload.single('file'), (req, res) => {
  const { course, college, year, subject } = req.body;
  if (req.file) {
    const filename = req.file.filename;

    // Insert file info into the database
    db.run(`INSERT INTO files (filename, course, college, year, subject) VALUES (?, ?, ?, ?, ?)`,
      [filename, course, college, year, subject],
      (err) => {
        if (err) {
          console.error('Error adding file to database:', err.message);
          res.status(500).send('Error saving file metadata');
        } else {
          console.log('File uploaded:', filename);
          res.send('File uploaded and saved to the database successfully!');
        }
      }
    );
  } else {
    res.status(400).send('No file uploaded');
  }
});

// Endpoint to fetch files with optional filters, sorted with closest matches first
app.get('/files', (req, res) => {
  const { course, year } = req.query;
  let query = 'SELECT * FROM files WHERE 1=1';
  const params = [];

  if (course) {
    query += ' AND (course = ? OR ? IS NULL)';
    params.push(course, course);
  }
  if (year) {
    query += ' AND (year = ? OR ? IS NULL)';
    params.push(year, year);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error retrieving files:', err.message);
      res.status(500).send('Error retrieving files');
    } else {
      // Filter out files that do not exist in the uploads folder
      const existingFiles = rows.filter(file => {
        const filePath = path.join(__dirname, 'uploads', file.filename);
        const exists = fs.existsSync(filePath);
        if (!exists) {
          // Delete missing file entry from database
          db.run('DELETE FROM files WHERE id = ?', [file.id], (deleteErr) => {
            if (deleteErr) console.error('Error deleting missing file from database:', deleteErr.message);
            else console.log(`Deleted database entry for missing file: ${file.filename}`);
          });
        }
        return exists;
      });

      // Sort files with closest matches first
      const sortedFiles = existingFiles.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;
        if (course && a.course === course) scoreA += 1;
        if (year && a.year === year) scoreA += 1;
        if (course && b.course === course) scoreB += 1;
        if (year && b.year === year) scoreB += 1;
        return scoreB - scoreA;  // Higher scores come first
      });

      res.json(sortedFiles);
    }
  });
});

// Endpoint to delete a file and remove it from the database
app.delete('/delete-file/:id', (req, res) => {
  const { id } = req.params;

  // Find the file by ID
  db.get('SELECT * FROM files WHERE id = ?', [id], (err, file) => {
    if (err) {
      console.error('Error retrieving file:', err.message);
      res.status(500).send('Error retrieving file');
      return;
    }

    if (!file) {
      res.status(404).send('File not found');
      return;
    }

    // Delete the file from the uploads folder
    const filePath = path.join(__dirname, 'uploads', file.filename);
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Error deleting file:', unlinkErr.message);
        res.status(500).send('Error deleting file');
        return;
      }

      // Remove the file entry from the database
      db.run('DELETE FROM files WHERE id = ?', [id], (deleteErr) => {
        if (deleteErr) {
          console.error('Error removing file from database:', deleteErr.message);
          res.status(500).send('Error removing file from database');
        } else {
          console.log(`Deleted file: ${file.filename}`);
          res.send('File successfully deleted');
        }
      });
    });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
