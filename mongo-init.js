db = db.getSiblingDB('farm_portal');

db.createUser({
  user: 'farm_user',
  pwd: 'farm_password',
  roles: [
    {
      role: 'readWrite',
      db: 'farm_portal'
    }
  ]
});
