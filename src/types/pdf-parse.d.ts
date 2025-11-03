declare module "pdf-parse" {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    version: string;
    text: string;
  }
  function pdf(data: Buffer | Uint8Array, options?: any): Promise<PDFData>;
  export default pdf;
}