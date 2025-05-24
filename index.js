const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { google } = require('googleapis');
const stream = require('stream');

// Config
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://boipoka-ebook.web.app',
    'https://boipoka-ebook.vercel.app'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Multer memory storage (no local file write)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Google Drive OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xmhoqrm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const booksCollection = client.db('boipoka-ebook').collection('books');

    // Upload Book
    app.post('/books', upload.single('pdf'), async (req, res) => {
      try {
        const { title, author, description } = req.body;
        const file = req.file;

        if (!title || !author || !file) {
          return res.status(400).send({ error: 'Missing required fields' });
        }

        // Create stream from buffer
        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        const response = await drive.files.create({
          requestBody: {
            name: file.originalname,
            mimeType: 'application/pdf',
          },
          media: {
            mimeType: 'application/pdf',
            body: bufferStream,
          },
          fields: 'id',
        });

        const fileId = response.data.id;

        // Make file public
        await drive.permissions.create({
          fileId,
          requestBody: {
            role: 'reader',
            type: 'anyone',
          },
        });

        const fileUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

        // Save to MongoDB
        const book = {
          title,
          author,
          description,
          driveUrl: fileUrl,
          uploadedAt: new Date(),
        };
        const result = await booksCollection.insertOne(book);

        res.send({
          message: 'Book uploaded successfully!',
          insertedId: result.insertedId,
          driveUrl: fileUrl,
        });
      } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).send({ error: 'Failed to upload book' });
      }
    });

    // Get all books
    app.get('/books', async (req, res) => {
      const books = await booksCollection.find().sort({ uploadedAt: -1 }).toArray();
      res.send(books);
    });

    console.log('MongoDB connected successfully!');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}
run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
  res.send('Boipoka Ebook Server is running...');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
