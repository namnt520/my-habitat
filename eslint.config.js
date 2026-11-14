import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Các hàm Math mà chuẩn ECMAScript KHÔNG quy định kết quả chính xác tới từng bit.
 * Lõi mô phỏng phải tất định giữa Node và mọi trình duyệt, nên bị cấm dùng chúng
 * (dùng `src/sim/detmath.ts` thay thế).
 */
const nonDeterministicMath = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'exp',
  'expm1',
  'log',
  'log2',
  'log10',
  'log1p',
  'pow',
  'cbrt',
  'hypot',
  'sinh',
  'cosh',
  'tanh',
].map((property) => ({
  object: 'Math',
  property,
  message: 'Không tất định giữa các engine JS — dùng src/sim/detmath.ts hoặc RNG có seed.',
}));

export default tseslint.config(
  { ignores: ['dist', 'out', 'node_modules', 'docs/data'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Lõi mô phỏng: không DOM, không thời gian thực, không toán học phi tất định.
    files: ['src/sim/**/*.ts', 'src/species/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nonDeterministicMath],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'performance',
          'Date',
          'navigator',
          'self',
          'setTimeout',
          'setInterval',
        ].map((name) => ({ name, message: 'Lõi mô phỏng phải thuần và tất định.' })),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'Toán tử ** không tất định với số mũ thực.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.{ts,mjs}', '*.config.{js,ts}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  prettier,
);
