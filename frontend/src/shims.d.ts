// react-syntax-highlighter ships its public types via @types, but the deep ESM
// entry points (individual Prism languages + the bundled styles) have no
// declarations. We import them only to register languages / pass a style object,
// so `any` is fine here.
declare module 'react-syntax-highlighter/dist/esm/languages/prism/*' {
  const language: unknown;
  export default language;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const styles: { [key: string]: { [key: string]: React.CSSProperties } };
  export const oneDark: Record<string, React.CSSProperties>;
  export default styles;
}
