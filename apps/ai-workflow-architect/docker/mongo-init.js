const appDbName = process.env.MONGO_APP_DATABASE;
const appUser = process.env.MONGO_APP_USER;
const appPassword = process.env.MONGO_APP_PASSWORD;
if (!appDbName || !appUser || !appPassword) {
  throw new Error('MONGO_APP_DATABASE, MONGO_APP_USER and MONGO_APP_PASSWORD are required');
}
db.getSiblingDB(appDbName).createUser({
  user: appUser,
  pwd: appPassword,
  roles: [{ role: 'readWrite', db: appDbName }],
});
