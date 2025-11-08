import { TextEncoder, TextDecoder } from 'util';

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';

// Mock global TextEncoder and TextDecoder for Node.js < 11
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;
