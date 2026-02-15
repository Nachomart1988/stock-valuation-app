// PDF Export utilities
// Install: npm install jspdf jspdf-autotable html2canvas

// Note: This file provides the structure. Install dependencies:
// npm install jspdf jspdf-autotable html2canvas @types/jspdf

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface CompanyData {
  symbol: string;
  companyName: string;
  price: number;
  marketCap: number;
  sector: string;
  industry: string;
}

interface ValuationData {
  model: string;
  value: number;
  upside: number;
}

interface QualityScore {
  dimension: string;
  score: number;
  grade: string;
}

interface ExportData {
  company: CompanyData;
  valuations: ValuationData[];
  qualityScores: QualityScore[];
  recommendation?: {
    action: string;
    confidence: number;
    targetPrice: number;
  };
  generatedAt: Date;
}

export async function generatePDF(data: ExportData): Promise<Blob> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  // Helper function to add section title
  const addSectionTitle = (title: string) => {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(59, 130, 246); // Blue color
    doc.text(title, 14, yPos);
    yPos += 8;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
  };

  // Header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(59, 130, 246);
  doc.text('StockAnalyzer Pro', 14, yPos);

  doc.setFontSize(10);
  doc.setTextColor(128, 128, 128);
  doc.text(`Generado: ${data.generatedAt.toLocaleDateString('es-ES')}`, pageWidth - 60, yPos);
  yPos += 15;

  // Company Info
  doc.setFontSize(20);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`${data.company.symbol} - ${data.company.companyName}`, 14, yPos);
  yPos += 10;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`Precio: $${data.company.price.toFixed(2)} | Market Cap: $${(data.company.marketCap / 1e9).toFixed(2)}B`, 14, yPos);
  yPos += 6;
  doc.text(`Sector: ${data.company.sector} | Industria: ${data.company.industry}`, 14, yPos);
  yPos += 15;

  // Recommendation Box (if available)
  if (data.recommendation) {
    const boxHeight = 25;
    const bgColor = data.recommendation.action === 'STRONG BUY' || data.recommendation.action === 'BUY'
      ? [34, 197, 94] // green
      : data.recommendation.action === 'SELL' || data.recommendation.action === 'STRONG SELL'
      ? [239, 68, 68] // red
      : [234, 179, 8]; // yellow

    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
    doc.roundedRect(14, yPos, pageWidth - 28, boxHeight, 3, 3, 'F');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(`Recomendación: ${data.recommendation.action}`, 20, yPos + 10);
    doc.setFontSize(11);
    doc.text(`Precio Objetivo: $${data.recommendation.targetPrice.toFixed(2)} | Confianza: ${(data.recommendation.confidence * 100).toFixed(0)}%`, 20, yPos + 18);

    yPos += boxHeight + 10;
    doc.setTextColor(0, 0, 0);
  }

  // Valuations Table
  addSectionTitle('Modelos de Valuación');

  const valuationRows = data.valuations.map(v => [
    v.model,
    `$${v.value.toFixed(2)}`,
    `${v.upside >= 0 ? '+' : ''}${v.upside.toFixed(1)}%`
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['Modelo', 'Valor Intrínseco', 'Upside/Downside']],
    body: valuationRows,
    theme: 'striped',
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: 255,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 50, halign: 'right' },
      2: { cellWidth: 50, halign: 'right' },
    },
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  // Quality Scores Table
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }

  addSectionTitle('Análisis de Calidad');

  const qualityRows = data.qualityScores.map(q => [
    q.dimension,
    `${q.score.toFixed(1)}/10`,
    q.grade
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['Dimensión', 'Score', 'Grado']],
    body: qualityRows,
    theme: 'striped',
    headStyles: {
      fillColor: [139, 92, 246],
      textColor: 255,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 40, halign: 'center' },
      2: { cellWidth: 40, halign: 'center' },
    },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Página ${i} de ${pageCount} | StockAnalyzer Pro - Este reporte es solo para fines informativos`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  return doc.output('blob');
}

export function downloadPDF(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
