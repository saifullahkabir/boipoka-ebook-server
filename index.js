const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { google } = require('googleapis');
const stream = require('stream');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

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
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

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
    const usersCollection = client.db('boipoka-ebook').collection('users');
    const myBooksCollection = client.db('boipoka-ebook').collection('my-books');

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Logout
    app.post('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            maxAge: 0,
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Upload Book
    app.post('/books', upload.single('pdf'), async (req, res) => {
      try {
        const bookData = JSON.parse(req.body.bookData);
        const file = req.file;

        if (!file) {
          return res.status(400).send({ error: 'PDF file is required' });
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
          ...bookData,
          fileUrl
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

    // delete a book data
    app.delete('/book/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.deleteOne(query);
      res.send(result);
    })

    // Save book (Read or Wishlist) data to DB
    app.put('/my-books', async (req, res) => {
      try {
        const { email, bookId, status } = req.body;

        // Check if the book already exists for the user
        const existing = await myBooksCollection.findOne({ email, bookId });


        if (existing) {
          if (existing.status === 'read') {
            return res.status(400).json({ message: 'Already marked as Read. Cannot add to Wishlist.' });
          }

          if (status === 'read') {
            // Update status to 'read'
            const updateResult = await myBooksCollection.updateOne(
              { email, bookId },
              { $set: { status: 'read' } }
            );
            return res.json({ message: 'Book marked as Read' });
          }

          return res.status(400).json({ message: 'Book already in Wishlist' });
        }

        // Insert new book entry
        const newBook = req.body;
        console.log(newBook);
        const insertResult = await myBooksCollection.insertOne(newBook);

        res.json({ message: `Book added to ${status}` });

      } catch (error) {
        console.error('Error saving book:', error);
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // get my-books data for specific user
    app.get('/my-books/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await myBooksCollection.find(query).toArray();
      res.json(result);
    })

    // save a user data in db 
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };

      // check if user already exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        if (user?.status === 'Requested') {
          // if existing user try to change his role
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status }
          });
          return res.send(result);
        }
        // if existing user login again
        return res.send(isExist);
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        }
      }
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    })

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
