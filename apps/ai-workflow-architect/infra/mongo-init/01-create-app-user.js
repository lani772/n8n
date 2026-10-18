const appDbName = process.env.MONGO_APP_DATABASE;
const appUser = process.env.MONGO_APP_USER;
const appPassword = process.env.MONGO_APP_PASSWORD;
if (!appDbName || !appUser || !appPassword) throw new Error("Mongo app user environment is required");
const appDb = db.getSiblingDB(appDbName);
appDb.createUser({ user: appUser, pwd: appPassword, roles: [{ role: "readWrite", db: appDbName }] });
