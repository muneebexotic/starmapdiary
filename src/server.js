const { app } = require("./app");
const { env } = require("./config/env");

app.listen(env.port, () => {
  console.log(`Star Map Diary server listening on http://localhost:${env.port}`);
});
