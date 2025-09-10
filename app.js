import express from "express";

const app = express();
const __dirname = import.meta.dirname;

app.use(express.urlencoded({ extended: true }));
app.use("/static", express.static("static"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/search", (req, res) => {
  res.sendFile(__dirname + "/tracuu.html");
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
