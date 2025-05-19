const express = require('express');
const app = express();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require('dotenv');
// Server start
const PORT = process.env.PORT || 5000;

dotenv.config();


app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// MongoDB connect
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

    // save book data in db
    app.post('/books', upload.single('pdf'), async (req, res) => {
      const { title, author } = req.body;
      const pdfPath = req.file.path;

      const book = { title, author, pdfPath };
      const result = await booksCollection.insertOne(book);

      res.send({ message: 'Book uploaded', id: result.insertedId });
    });

    app.get('/books', async (req, res) => {
      const books = await booksCollection.find().toArray();
      res.send(books);
    });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);




app.get('/', (req, res) => {
  res.send('Boipoka Ebook Server is running...')
})


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
