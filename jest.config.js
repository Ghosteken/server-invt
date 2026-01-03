/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: 'tsconfig.json', useESM: true }
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  collectCoverage: false,
  verbose: false,
  setupFiles: ['<rootDir>/jest.setup.js'],
};