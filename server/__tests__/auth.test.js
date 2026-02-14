import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Permission from '../models/Permission.js';
import { register, login, getMe, changePassword } from '../controllers/authController.js';

let db;

beforeAll(async () => {
  db = await connectDB();
});

afterAll(async () => {
  await closeDB();
});

beforeEach(async () => {
  await clearDB();
});

// ── Helpers ──

async function createApprovedUser(overrides = {}) {
  const defaults = {
    email: 'test@example.com',
    password: 'password123',
    name: 'Test User',
    isActive: true,
    isApproved: true,
    roles: []
  };
  return User.create({ ...defaults, ...overrides });
}

async function createRoleWithPermission(roleName, permName) {
  const perm = await Permission.create({
    name: permName,
    description: `${permName} permission`,
    module: 'test'
  });
  const role = await Role.create({
    name: roleName,
    description: `${roleName} role`,
    permissions: [perm._id]
  });
  return { role, perm };
}

// ═══════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════

describe('Auth - Register', () => {
  test('creates user with hashed password', async () => {
    const req = mockReq({
      email: 'new@example.com',
      password: 'secret123',
      name: 'New User'
    });
    const res = mockRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.user.email).toBe('new@example.com');
    expect(body.user.name).toBe('New User');
    expect(body.user.isApproved).toBe(false);

    // Verify password is hashed in the database
    const dbUser = await User.findOne({ email: 'new@example.com' });
    expect(dbUser).not.toBeNull();
    expect(dbUser.password).not.toBe('secret123');
    const isHashed = await bcrypt.compare('secret123', dbUser.password);
    expect(isHashed).toBe(true);
  });

  test('rejects duplicate email', async () => {
    // Create an existing user first
    await createApprovedUser({ email: 'dup@example.com' });

    const req = mockReq({
      email: 'dup@example.com',
      password: 'another123',
      name: 'Duplicate'
    });
    const res = mockRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toMatch(/email/i);
  });
});

// ═══════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════

describe('Auth - Login', () => {
  test('returns token for valid credentials', async () => {
    const { role } = await createRoleWithPermission('admin', 'users.manage');
    await createApprovedUser({
      email: 'login@example.com',
      password: 'mypassword',
      roles: [role._id]
    });

    const req = mockReq({
      email: 'login@example.com',
      password: 'mypassword'
    });
    // login reads req.ip and req.get('user-agent')
    req.ip = '127.0.0.1';
    req.get = () => 'jest-test-agent';
    const res = mockRes();

    await login(req, res);

    // Should not have set an error status
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.accessToken).toBeDefined();
    expect(typeof body.accessToken).toBe('string');
    expect(body.refreshToken).toBeDefined();
    expect(body.user.email).toBe('login@example.com');
    expect(body.user.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'admin' })
      ])
    );
    expect(body.user.permissions).toEqual(
      expect.arrayContaining(['users.manage'])
    );
  });

  test('rejects wrong password', async () => {
    await createApprovedUser({
      email: 'wrongpw@example.com',
      password: 'correctpassword'
    });

    const req = mockReq({
      email: 'wrongpw@example.com',
      password: 'wrongpassword'
    });
    req.ip = '127.0.0.1';
    req.get = () => 'jest-test-agent';
    const res = mockRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });

  test('rejects non-existent user', async () => {
    const req = mockReq({
      email: 'nobody@example.com',
      password: 'whatever'
    });
    req.ip = '127.0.0.1';
    req.get = () => 'jest-test-agent';
    const res = mockRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// GET ME
// ═══════════════════════════════════════════

describe('Auth - getMe', () => {
  test('returns user data from req.user', async () => {
    const { role } = await createRoleWithPermission('grower', 'plants.view');
    const user = await createApprovedUser({
      email: 'me@example.com',
      name: 'Me User',
      roles: [role._id]
    });

    const req = mockReq({}, {}, {}, { _id: user._id });
    const res = mockRes();

    await getMe(req, res);

    // Should not have set an error status
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.email).toBe('me@example.com');
    expect(body.name).toBe('Me User');
    expect(body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'grower' })
      ])
    );
    expect(body.permissions).toEqual(
      expect.arrayContaining(['plants.view'])
    );
    // Password and refreshToken should not be present
    expect(body.password).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// CHANGE PASSWORD
// ═══════════════════════════════════════════

describe('Auth - changePassword', () => {
  test('updates password with correct old password', async () => {
    const user = await createApprovedUser({
      email: 'changepw@example.com',
      password: 'oldpassword'
    });

    const req = mockReq(
      { currentPassword: 'oldpassword', newPassword: 'newpassword123' },
      {},
      {},
      { _id: user._id }
    );
    req.ip = '127.0.0.1';
    req.get = () => 'jest-test-agent';
    const res = mockRes();

    await changePassword(req, res);

    // Should not have set an error status
    expect(res.status).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();

    // Verify the new password works
    const updatedUser = await User.findById(user._id);
    const newPasswordWorks = await updatedUser.comparePassword('newpassword123');
    expect(newPasswordWorks).toBe(true);

    // Verify old password no longer works
    const oldPasswordWorks = await updatedUser.comparePassword('oldpassword');
    expect(oldPasswordWorks).toBe(false);
  });

  test('rejects wrong old password', async () => {
    const user = await createApprovedUser({
      email: 'rejectpw@example.com',
      password: 'realpassword'
    });

    const req = mockReq(
      { currentPassword: 'wrongoldpassword', newPassword: 'newpassword123' },
      {},
      {},
      { _id: user._id }
    );
    req.ip = '127.0.0.1';
    req.get = () => 'jest-test-agent';
    const res = mockRes();

    await changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();

    // Verify the original password still works (nothing changed)
    const unchangedUser = await User.findById(user._id);
    const originalStillWorks = await unchangedUser.comparePassword('realpassword');
    expect(originalStillWorks).toBe(true);
  });
});
