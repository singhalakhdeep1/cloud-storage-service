module.exports = {
    testEnvironment: 'node',
    // both suites use the same database and clean it with deleteMany, so they must not run at the same time
    maxWorkers: 1,
    testMatch: ['**/tests/**/*.test.js'],
    setupFiles: ['<rootDir>/jest.setup.ts'],
    transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true, diagnostics: false }] },
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/frontend/'],
    collectCoverageFrom: ['models/**/*.ts', 'utils/**/*.ts', 'services/**/*.ts', 'controllers/**/*.ts', '!**/*.d.ts'],
    verbose: true,
};
