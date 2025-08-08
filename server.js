const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const port = process.env.PORT ||5001;
const local = "http://localhost:"
const server = "http://192.168.50.207:"

// Enable CORS for your React app
app.use(cors());
app.use(express.json());

// Storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "./uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
      fieldSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error("Only JPEG, PNG, and GIF files are allowed"));
      }
      cb(null, true);
    }
  });

// API to upload receipt
app.post("/upload", upload.single("receipt"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
  
    const { total, timestamp, note, cname } = req.body;
  
    const receiptMeta = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      filepath: `/uploads/${req.file.filename}`,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedAt: timestamp || new Date().toISOString(),
      total: total || "ç0.00",
      note: note || "",
      cname: cname || "",
    };
  
    const dataPath = path.join(__dirname, "receipts.json");
  
    // Append to receipts.json
    let existing = [];
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath);
      existing = JSON.parse(raw);
    }
  
    existing.push(receiptMeta);
    fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));
  
    res.json({
      message: "Receipt uploaded and saved with metadata",
      receipt: receiptMeta,
    });
  });

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/receipts", (req, res) => {
    const dataPath = path.join(__dirname, "receipts.json");
    if (!fs.existsSync(dataPath)) {
      return res.json([]);
    }
  
    const rawData = fs.readFileSync(dataPath);
    try {
      const receipts = JSON.parse(rawData);
      res.json(receipts);
    } catch (err) {
      res.status(500).json({ error: "Failed to parse receipts.json" });
    }
  });

  // Test route
app.get('/', (req, res) => {
  res.send('B-Store Server is running 🚀');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
