import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/script.mjs',
  output: {
    file: 'dist/index.js',
    format: 'cjs',
    banner: '// SGNL Job Script - Auto-generated bundle'
  },
  plugins: [
    nodeResolve({
      preferBuiltins: true
    }),
    commonjs()
  ],
  external: [
    // Node.js built-ins
    'fs', 'path', 'url', 'util', 'crypto', 'https', 'http'
  ]
};