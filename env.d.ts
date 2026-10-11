// Vite 静态资源副作用导入的类型占位：TS6 起对副作用导入也要求模块声明（TS2882），
// 构建由 vite 处理，这里只管类型层
declare module '*.css';
