# オフライン手書きメモアプリ (Offline Memo App)

オフラインで動作し、手書きとテキストを混在させて記録できる高機能メモアプリです。
Android端末などでのPWA（アプリとしてのインストール）に対応しています。

## ✨ 特徴
- **完全オフライン対応**: 電波がない場所でも閲覧・編集が可能。
- **手書き & テキスト**: ペンで自由に書き込み、キーボードでテキスト入力も可能。
- **図形補正**: 手書きの四角や丸を綺麗に自動整形。
- **OCR (文字認識)**: 手書き文字をテキストデータに変換。
- **リンク機能**: メモ同士をリンクで繋げ、ナレッジベースのように使えます。

## 📖 使い方 (User Guide)

### 基本操作
1. **メモの作成**: 左サイドバー（スマホではメニューボタン）からフォルダを選び、「＋」ボタンで新規メモを作成。
2. **モード切替**: エディタ上部のアイコンでモードを切り替えます。
   - 👁️ **View Mode (閲覧)**: リンクをタップして移動できます。編集不可。
   - ⌨️ **Text Mode (テキスト)**: キーボードで文字を入力します。
   - 🖊️ **Pen Mode (ペン)**: 指やスタイラスで手書きします（**1本指で描画、2本指でスクロール**）。
   - 🧹 **Eraser Mode (消しゴム)**: 手書き線を消します。

### 便利な機能
- **図形補正 (Shape Checkbox)**: 
  - 上部の「Shape」にチェックを入れた状態で、「四角」や「丸」を一筆書きすると、自動的に綺麗な図形に変換されます。
- **手書き文字認識 (OCR)**:
  - 「OCRアイコン（[T]のようなマーク）」を押すと、キャンバス内の手書き文字を読み取り、テキストとして末尾に追加します。
- **リンク (Wiki機能)**:
  - Text Modeで文字を選択し、「Link」ボタンを押すと `[[タイトル]]` という形式になります。
  - View Modeでこれをタップすると、そのタイトルのメモへジャンプ（なければ新規作成）します。

### インストール方法 (Android)
1. Chromeでアプリを開く。
2. メニュー「︙」から「ホーム画面に追加」または「アプリをインストール」を選択。
3. ホーム画面のアイコンから、ネイティブアプリのように起動できます。

## 開発者向け情報
- Built with React, Vite, Tailwind CSS, Dexie.js (IndexedDB).
    tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
