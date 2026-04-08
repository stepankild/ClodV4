import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { archiveService } from '../../services/archiveService';
import { useAuth } from '../../context/AuthContext';
import { localizeRoomName } from '../../utils/localizeRoomName';
import ArchiveHeatMap from '../../components/RoomMap/ArchiveHeatMap';
import CrewInfographic from '../../components/Harvest/CrewInfographic';

// ── Extra Nutrition PDF Report ──────────────────────────────────────

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function pdfHeatColor(weight, sortedWeights) {
  if (!weight || sortedWeights.length < 2) return hslToRgb(120, 70, 22);
  let below = 0;
  for (const w of sortedWeights) { if (w < weight) below++; else break; }
  const pct = below / (sortedWeights.length - 1);
  const stops = [
    { p: 0, h: 0, s: 85, l: 20 }, { p: 0.25, h: 25, s: 85, l: 24 },
    { p: 0.50, h: 50, s: 80, l: 26 }, { p: 0.75, h: 85, s: 75, l: 24 },
    { p: 1, h: 140, s: 70, l: 22 },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].p && pct <= stops[i + 1].p) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const f = hi.p === lo.p ? 0.5 : (pct - lo.p) / (hi.p - lo.p);
  return hslToRgb(
    lo.h + (hi.h - lo.h) * f,
    lo.s + (hi.s - lo.s) * f,
    lo.l + (hi.l - lo.l) * f
  );
}

function pdfHeatTextColor(weight, sortedWeights) {
  if (!weight || sortedWeights.length < 2) return hslToRgb(120, 60, 75);
  let below = 0;
  for (const w of sortedWeights) { if (w < weight) below++; else break; }
  const pct = below / (sortedWeights.length - 1);
  const stops = [
    { p: 0, h: 0, s: 75, l: 75 }, { p: 0.25, h: 25, s: 75, l: 78 },
    { p: 0.50, h: 50, s: 70, l: 80 }, { p: 0.75, h: 85, s: 65, l: 78 },
    { p: 1, h: 140, s: 60, l: 75 },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].p && pct <= stops[i + 1].p) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const f = hi.p === lo.p ? 0.5 : (pct - lo.p) / (hi.p - lo.p);
  return hslToRgb(
    lo.h + (hi.h - lo.h) * f,
    lo.s + (hi.s - lo.s) * f,
    lo.l + (hi.l - lo.l) * f
  );
}

async function generateNutritionPDF(archive, t, locale) {
  const [{ jsPDF }, { RobotoRegular }, { RobotoBold }] = await Promise.all([
    import('jspdf'),
    import('../../fonts/Roboto-Regular'),
    import('../../fonts/Roboto-Bold')
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.addFileToVFS('Roboto-Regular.ttf', RobotoRegular);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', RobotoBold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');

  const pw = 210, ph = 297, mx = 12;
  const cw = pw - mx * 2;
  const BG = [18, 18, 24];
  const fmtNum = (n) => n != null && Number.isFinite(n) ? Number(n).toLocaleString(locale) : '—';
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  const rect = (x, y, w, h, rgb) => { doc.setFillColor(...rgb); doc.rect(x, y, w, h, 'F'); };
  const roundRect = (x, y, w, h, r, rgb) => { doc.setFillColor(...rgb); doc.roundedRect(x, y, w, h, r, r, 'F'); };
  const pageBg = () => rect(0, 0, pw, ph, BG);
  const footer = () => {
    doc.setFont('Roboto', 'normal'); doc.setFontSize(7); doc.setTextColor(80, 80, 100);
    doc.text('True Source  ·  Extra Nutrition Report', mx, ph - 8);
    doc.text(new Date().toLocaleString(locale), pw - mx, ph - 8, { align: 'right' });
  };

  // ── Data prep ──
  const extraSet = new Set(archive.extraNutritionPlants);
  const allPlants = (archive.harvestMapData?.plants || []).filter(p => p.wetWeight > 0);
  const withN = allPlants.filter(p => extraSet.has(p.plantNumber));
  const withoutN = allPlants.filter(p => !extraSet.has(p.plantNumber));
  const sortedW = allPlants.map(p => p.wetWeight).sort((a, b) => a - b);

  const calcG = (arr) => {
    if (!arr.length) return { avg: 0, median: 0, min: 0, max: 0, total: 0, count: 0 };
    const w = arr.map(p => p.wetWeight).sort((a, b) => a - b);
    const total = w.reduce((s, v) => s + v, 0);
    const median = w.length % 2 === 0 ? Math.round((w[w.length / 2 - 1] + w[w.length / 2]) / 2) : w[Math.floor(w.length / 2)];
    return { avg: Math.round(total / w.length), median, min: w[0], max: w[w.length - 1], total, count: w.length };
  };

  const sW = calcG(withN);
  const sWO = calcG(withoutN);
  const diff = sW.avg - sWO.avg;
  const diffPct = sWO.avg > 0 ? ((diff / sWO.avg) * 100).toFixed(1) : '0.0';
  const medDiff = sW.median - sWO.median;
  const medDiffPct = sWO.median > 0 ? ((medDiff / sWO.median) * 100).toFixed(1) : '0.0';
  const diffColor = diff > 0 ? [100, 230, 120] : diff < 0 ? [230, 100, 100] : [160, 160, 180];
  const roomLabel = archive.roomName || `${t('archive.room')} ${archive.roomNumber}`;

  // ══════════ PAGE 1: Header + Room Map ══════════
  pageBg();
  let y = 12;

  // Header bar
  roundRect(mx, y, cw, 22, 3, [26, 26, 36]);
  doc.setFont('Roboto', 'bold'); doc.setFontSize(16); doc.setTextColor(255, 255, 255);
  doc.text(t('archive.nutritionReport'), mx + 6, y + 10);
  doc.setFont('Roboto', 'normal'); doc.setFontSize(9); doc.setTextColor(140, 140, 170);
  doc.text(`${roomLabel}  ·  ${archive.strain || ''}  ·  ${fmtDate(archive.harvestDate)}  ·  ${archive.plantsCount} ${t('common.pcs')}  ·  ${archive.actualDays} ${t('archive.daysLabel')}`, mx + 6, y + 18);
  y += 28;

  // ── Room map ──
  const { customRows = [], plants = [] } = archive.harvestMapData || {};
  if (customRows.length && plants.length) {
    doc.setFont('Roboto', 'bold'); doc.setFontSize(10); doc.setTextColor(220, 220, 240);
    doc.text(t('archive.harvestMap'), mx, y + 4);

    // Legend
    doc.setFontSize(7); doc.setFont('Roboto', 'normal');
    const legX = mx + cw - 50;
    roundRect(legX - 2, y - 1, 52, 7, 1, [30, 30, 40]);
    doc.setFillColor(200, 170, 50); doc.rect(legX, y + 0.5, 3, 3, 'F');
    doc.setTextColor(200, 170, 50); doc.text(t('harvest.extraNutrition'), legX + 5, y + 3.5);
    doc.setFillColor(70, 70, 90); doc.rect(legX + 32, y + 0.5, 3, 3, 'F');
    doc.setTextColor(120, 120, 150); doc.text(t('harvest.withoutNutrition').substring(0, 6), legX + 37, y + 3.5);
    y += 9;

    // Build position map
    const posMap = {};
    plants.forEach(p => { posMap[`${p.row}:${p.position}`] = p; });

    // Calculate cell size to fit in available width
    const totalCols = customRows.reduce((max, r) => Math.max(max, r.cols || 1), 0);
    const numRows = customRows.length;
    const gapBetweenRows = 3;
    const mapWidth = cw;
    const rowNameW = 18;
    const availW = mapWidth - rowNameW;
    const cellGap = 0.8;
    const cellSize = Math.min((availW - (totalCols - 1) * cellGap) / totalCols, 10);
    const mapAvailH = ph - y - 20; // leave room for footer
    const totalGridRows = customRows.reduce((sum, r) => sum + (r.rows || 1), 0);
    const cellH = Math.min(cellSize, (mapAvailH - (numRows - 1) * gapBetweenRows - numRows * 5) / totalGridRows);
    const cs = Math.min(cellSize, cellH, 10);

    customRows.forEach((row, rowIdx) => {
      const cols = row.cols || 1;
      const rowRows = row.rows || 1;

      // Row label
      doc.setFont('Roboto', 'bold'); doc.setFontSize(6.5); doc.setTextColor(100, 100, 130);
      doc.text(row.name || `${t('roomMap.rowDefault', { num: rowIdx + 1 })}`, mx, y + cs * 0.6);

      for (let rr = 0; rr < rowRows; rr++) {
        for (let cc = 0; cc < cols; cc++) {
          const posIdx = rr * cols + cc;
          const plant = posMap[`${rowIdx}:${posIdx}`];
          const cx = mx + rowNameW + cc * (cs + cellGap);
          const cy = y + rr * (cs + cellGap);

          if (!plant || !plant.wetWeight) {
            roundRect(cx, cy, cs, cs, 1, [28, 28, 36]);
            continue;
          }

          const isNutr = extraSet.has(plant.plantNumber);
          const bgColor = pdfHeatColor(plant.wetWeight, sortedW);
          const txtColor = pdfHeatTextColor(plant.wetWeight, sortedW);

          roundRect(cx, cy, cs, cs, 1, bgColor);

          // Yellow border for nutrition plants
          if (isNutr) {
            doc.setDrawColor(210, 180, 50);
            doc.setLineWidth(0.6);
            doc.roundedRect(cx, cy, cs, cs, 1, 1, 'S');
          }

          // Plant number
          doc.setFont('Roboto', 'bold'); doc.setFontSize(cs > 7 ? 5.5 : 4.5);
          doc.setTextColor(...txtColor);
          doc.text(String(plant.plantNumber), cx + cs / 2, cy + cs * 0.38, { align: 'center' });

          // Weight
          doc.setFont('Roboto', 'normal'); doc.setFontSize(cs > 7 ? 4.5 : 3.8);
          doc.text(`${plant.wetWeight}`, cx + cs / 2, cy + cs * 0.7, { align: 'center' });
        }
      }

      y += rowRows * (cs + cellGap) + gapBetweenRows;
    });

    y += 2;
  }

  // Legend gradient bar
  if (y + 8 < ph - 15) {
    const gradW = cw * 0.6;
    const gradX = mx + (cw - gradW) / 2;
    const gradSteps = 40;
    const stepW = gradW / gradSteps;
    for (let i = 0; i < gradSteps; i++) {
      const frac = i / (gradSteps - 1);
      const h = frac * 140;
      const s = 85 - frac * 15;
      const l = 20 + frac * 2;
      const rgb = hslToRgb(h, s, l);
      rect(gradX + i * stepW, y, stepW + 0.1, 3, rgb);
    }
    doc.setFont('Roboto', 'normal'); doc.setFontSize(6); doc.setTextColor(100, 100, 130);
    const gMin = sortedW.length ? sortedW[0] : 0;
    const gMax = sortedW.length ? sortedW[sortedW.length - 1] : 0;
    doc.text(`${gMin}${t('common.grams')}`, gradX, y + 7);
    doc.text(`${gMax}${t('common.grams')}`, gradX + gradW, y + 7, { align: 'right' });
    y += 10;
  }

  footer();

  // ══════════ PAGE 2: Statistics + Charts ══════════
  doc.addPage();
  pageBg();
  y = 12;

  // ── Summary cards ──
  const blockW = (cw - 6) / 3;

  // With nutrition
  roundRect(mx, y, blockW, 28, 3, [28, 50, 32]);
  doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 200, 130);
  doc.text(t('harvest.withNutrition'), mx + blockW / 2, y + 7, { align: 'center' });
  doc.setFont('Roboto', 'bold'); doc.setFontSize(22); doc.setTextColor(110, 230, 100);
  doc.text(`${fmtNum(sW.avg)}${t('common.grams')}`, mx + blockW / 2, y + 19, { align: 'center' });
  doc.setFont('Roboto', 'normal'); doc.setFontSize(6.5); doc.setTextColor(110, 140, 100);
  doc.text(`${sW.count} ${t('common.pcs')}  ·  ${fmtNum(sW.total)}${t('common.grams')}`, mx + blockW / 2, y + 25, { align: 'center' });

  // Without nutrition
  const bx2 = mx + blockW + 3;
  roundRect(bx2, y, blockW, 28, 3, [30, 30, 40]);
  doc.setFontSize(7.5); doc.setTextColor(130, 130, 160);
  doc.text(t('harvest.withoutNutrition'), bx2 + blockW / 2, y + 7, { align: 'center' });
  doc.setFont('Roboto', 'bold'); doc.setFontSize(22); doc.setTextColor(190, 190, 210);
  doc.text(`${fmtNum(sWO.avg)}${t('common.grams')}`, bx2 + blockW / 2, y + 19, { align: 'center' });
  doc.setFont('Roboto', 'normal'); doc.setFontSize(6.5); doc.setTextColor(110, 110, 140);
  doc.text(`${sWO.count} ${t('common.pcs')}  ·  ${fmtNum(sWO.total)}${t('common.grams')}`, bx2 + blockW / 2, y + 25, { align: 'center' });

  // Difference
  const bx3 = mx + (blockW + 3) * 2;
  const diffBg = diff > 0 ? [25, 50, 30] : diff < 0 ? [50, 25, 25] : [30, 30, 40];
  roundRect(bx3, y, blockW, 28, 3, diffBg);
  doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(160, 160, 180);
  doc.text(t('harvest.difference'), bx3 + blockW / 2, y + 7, { align: 'center' });
  doc.setFont('Roboto', 'bold'); doc.setFontSize(22); doc.setTextColor(...diffColor);
  doc.text(`${diff > 0 ? '+' : ''}${fmtNum(diff)}${t('common.grams')}`, bx3 + blockW / 2, y + 19, { align: 'center' });
  doc.setFont('Roboto', 'normal'); doc.setFontSize(10); doc.setTextColor(...diffColor);
  doc.text(`${diff > 0 ? '+' : ''}${diffPct}%`, bx3 + blockW / 2, y + 25, { align: 'center' });

  y += 35;

  // ── Bar chart: avg / median / min / max comparison ──
  doc.setFont('Roboto', 'bold'); doc.setFontSize(10); doc.setTextColor(220, 220, 240);
  doc.text(t('archive.nutritionReportDetailed'), mx, y + 4);
  y += 10;

  const barMetrics = [
    { label: t('archive.avgWeightLabel'), vW: sW.avg, vWO: sWO.avg },
    { label: t('archive.medianLabel'), vW: sW.median, vWO: sWO.median },
    { label: t('archive.minWeightLabel'), vW: sW.min, vWO: sWO.min },
    { label: t('archive.maxWeightLabel'), vW: sW.max, vWO: sWO.max },
    { label: t('archive.totalWeightLabel'), vW: sW.total, vWO: sWO.total },
  ];

  const chartH = 40;
  const chartX = mx + 30;
  const chartW = cw - 30;
  const barGroupW = chartW / barMetrics.length;
  const barW = barGroupW * 0.3;
  const barGap = 2;
  const maxVal = Math.max(...barMetrics.map(m => Math.max(m.vW, m.vWO)), 1);

  // Chart background
  roundRect(mx, y - 2, cw, chartH + 18, 3, [24, 24, 34]);

  // Grid lines
  doc.setDrawColor(40, 40, 55); doc.setLineWidth(0.15);
  for (let i = 0; i <= 4; i++) {
    const gy = y + chartH - (chartH * i / 4);
    doc.line(chartX, gy, mx + cw - 4, gy);
    doc.setFont('Roboto', 'normal'); doc.setFontSize(5); doc.setTextColor(70, 70, 95);
    doc.text(String(Math.round(maxVal * i / 4)), chartX - 2, gy + 1.5, { align: 'right' });
  }

  barMetrics.forEach((m, i) => {
    const gx = chartX + i * barGroupW + barGroupW * 0.2;
    const h1 = maxVal > 0 ? (m.vW / maxVal) * chartH : 0;
    const h2 = maxVal > 0 ? (m.vWO / maxVal) * chartH : 0;

    // Bar: with nutrition (yellow/green)
    if (h1 > 0) {
      const by = y + chartH - h1;
      roundRect(gx, by, barW, h1, 1, [180, 160, 50]);
      doc.setFont('Roboto', 'bold'); doc.setFontSize(4.5); doc.setTextColor(230, 210, 80);
      doc.text(fmtNum(m.vW), gx + barW / 2, by - 1.5, { align: 'center' });
    }

    // Bar: without nutrition (gray)
    if (h2 > 0) {
      const by = y + chartH - h2;
      roundRect(gx + barW + barGap, by, barW, h2, 1, [60, 60, 80]);
      doc.setFont('Roboto', 'bold'); doc.setFontSize(4.5); doc.setTextColor(140, 140, 170);
      doc.text(fmtNum(m.vWO), gx + barW + barGap + barW / 2, by - 1.5, { align: 'center' });
    }

    // Label
    doc.setFont('Roboto', 'normal'); doc.setFontSize(5.5); doc.setTextColor(110, 110, 140);
    doc.text(m.label, gx + barW + barGap / 2, y + chartH + 5, { align: 'center' });
  });

  // Chart legend
  const legY = y + chartH + 9;
  doc.setFillColor(180, 160, 50); doc.rect(chartX, legY, 3, 2.5, 'F');
  doc.setFont('Roboto', 'normal'); doc.setFontSize(5.5); doc.setTextColor(180, 160, 50);
  doc.text(t('harvest.withNutrition'), chartX + 5, legY + 2);
  doc.setFillColor(60, 60, 80); doc.rect(chartX + 40, legY, 3, 2.5, 'F');
  doc.setTextColor(110, 110, 140);
  doc.text(t('harvest.withoutNutrition'), chartX + 45, legY + 2);

  y += chartH + 24;

  // ── Metrics table ──
  roundRect(mx, y, cw, 8, 2, [28, 28, 40]);
  doc.setFont('Roboto', 'bold'); doc.setFontSize(7.5); doc.setTextColor(140, 140, 170);
  const colX = [mx + 4, mx + 50, mx + 95, mx + 140];
  doc.text(t('archive.metric'), colX[0], y + 5.5);
  doc.text(t('harvest.withNutrition'), colX[1], y + 5.5);
  doc.text(t('harvest.withoutNutrition'), colX[2], y + 5.5);
  doc.text(t('harvest.difference'), colX[3], y + 5.5);
  y += 8;

  const tableRows = [
    [t('archive.plantsLabel'), String(sW.count), String(sWO.count), '—', 0],
    [t('archive.avgWeightLabel'), `${fmtNum(sW.avg)}${t('common.grams')}`, `${fmtNum(sWO.avg)}${t('common.grams')}`, `${diff > 0 ? '+' : ''}${fmtNum(diff)}${t('common.grams')} (${diff > 0 ? '+' : ''}${diffPct}%)`, diff],
    [t('archive.medianLabel'), `${fmtNum(sW.median)}${t('common.grams')}`, `${fmtNum(sWO.median)}${t('common.grams')}`, `${medDiff > 0 ? '+' : ''}${fmtNum(medDiff)}${t('common.grams')} (${medDiff > 0 ? '+' : ''}${medDiffPct}%)`, medDiff],
    [t('archive.minWeightLabel'), `${fmtNum(sW.min)}${t('common.grams')}`, `${fmtNum(sWO.min)}${t('common.grams')}`, '—', 0],
    [t('archive.maxWeightLabel'), `${fmtNum(sW.max)}${t('common.grams')}`, `${fmtNum(sWO.max)}${t('common.grams')}`, '—', 0],
    [t('archive.totalWeightLabel'), `${fmtNum(sW.total)}${t('common.grams')}`, `${fmtNum(sWO.total)}${t('common.grams')}`, `${fmtNum(sW.total + sWO.total)}${t('common.grams')}`, 0],
  ];

  tableRows.forEach((row, i) => {
    if (i % 2 === 0) roundRect(mx, y, cw, 7, 0, [24, 24, 32]);
    doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 160); doc.text(row[0], colX[0], y + 5);
    doc.setTextColor(220, 200, 100); doc.text(row[1], colX[1], y + 5);
    doc.setTextColor(180, 180, 200); doc.text(row[2], colX[2], y + 5);
    if (row[3] !== '—') {
      const v = row[4];
      doc.setTextColor(v > 0 ? 100 : v < 0 ? 230 : 130, v > 0 ? 230 : v < 0 ? 100 : 130, v > 0 ? 120 : v < 0 ? 100 : 160);
    } else {
      doc.setTextColor(70, 70, 90);
    }
    doc.text(row[3], colX[3], y + 5);
    y += 7;
  });

  y += 6;

  // ── Weight distribution histogram ──
  const allW_nutr = withN.map(p => p.wetWeight).sort((a, b) => a - b);
  const allW_noNutr = withoutN.map(p => p.wetWeight).sort((a, b) => a - b);
  if (allW_nutr.length >= 2 || allW_noNutr.length >= 2) {
    const allWeights = [...allW_nutr, ...allW_noNutr];
    const hMin = Math.min(...allWeights);
    const hMax = Math.max(...allWeights);
    const bucketCount = 8;
    const bucketSize = (hMax - hMin) / bucketCount || 1;

    const bucketsN = Array(bucketCount).fill(0);
    const bucketsWO = Array(bucketCount).fill(0);
    allW_nutr.forEach(w => { bucketsN[Math.min(Math.floor((w - hMin) / bucketSize), bucketCount - 1)]++; });
    allW_noNutr.forEach(w => { bucketsWO[Math.min(Math.floor((w - hMin) / bucketSize), bucketCount - 1)]++; });
    const maxBucket = Math.max(...bucketsN, ...bucketsWO, 1);

    doc.setFont('Roboto', 'bold'); doc.setFontSize(9); doc.setTextColor(200, 200, 220);
    doc.text(t('roomMap.weightDistribution'), mx, y + 4);
    y += 8;

    const histH = 32;
    const histX = mx + 8;
    const histW = cw - 16;
    roundRect(mx, y - 2, cw, histH + 16, 3, [24, 24, 34]);

    const bw = histW / bucketCount;
    const singleBarW = bw * 0.35;

    for (let i = 0; i < bucketCount; i++) {
      const bx = histX + i * bw;
      const h1 = maxBucket > 0 ? (bucketsN[i] / maxBucket) * histH : 0;
      const h2 = maxBucket > 0 ? (bucketsWO[i] / maxBucket) * histH : 0;

      if (h1 > 0) roundRect(bx + bw * 0.1, y + histH - h1, singleBarW, h1, 1, [180, 160, 50]);
      if (h2 > 0) roundRect(bx + bw * 0.1 + singleBarW + 1, y + histH - h2, singleBarW, h2, 1, [60, 60, 80]);

      // Bucket label
      doc.setFont('Roboto', 'normal'); doc.setFontSize(4.5); doc.setTextColor(90, 90, 110);
      const from = Math.round(hMin + i * bucketSize);
      const to = Math.round(hMin + (i + 1) * bucketSize);
      doc.text(`${from}-${to}`, bx + bw / 2, y + histH + 4, { align: 'center' });
    }

    doc.setFont('Roboto', 'normal'); doc.setFontSize(5); doc.setTextColor(80, 80, 100);
    doc.text(t('common.grams'), histX + histW / 2, y + histH + 8, { align: 'center' });

    y += histH + 16;
  }

  // ── Conclusion ──
  y += 4;
  if (y + 18 > ph - 15) { doc.addPage(); pageBg(); y = 15; }
  const concBg = diff > 0 ? [22, 45, 28] : diff < 0 ? [45, 22, 22] : [28, 28, 38];
  roundRect(mx, y, cw, 16, 3, concBg);
  doc.setFont('Roboto', 'bold'); doc.setFontSize(9); doc.setTextColor(...diffColor);
  const conclusion = diff > 0
    ? t('archive.nutritionPositive', { pct: diffPct, grams: diff })
    : diff < 0
      ? t('archive.nutritionNegative', { pct: Math.abs(parseFloat(diffPct)).toFixed(1), grams: Math.abs(diff) })
      : t('archive.nutritionNeutral');
  const lines = doc.splitTextToSize(conclusion, cw - 10);
  doc.text(lines, mx + 5, y + (lines.length === 1 ? 10 : 6));

  footer();

  // ── Save ──
  const fname = `nutrition-report-${roomLabel}-${fmtDate(archive.harvestDate).replace(/[/.]/g, '-')}.pdf`;
  doc.save(fname);
}

const formatDate = (date, locale) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = (date, locale) => {
  if (!date) return '—';
  return new Date(date).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatNum = (n, locale) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString(locale) : '—');

const qualityColor = { low: 'text-red-400', medium: 'text-yellow-400', high: 'text-green-400', premium: 'text-purple-400' };

// Section component
const Section = ({ title, icon, children, className = '' }) => (
  <section className={`bg-dark-800/50 rounded-xl border border-dark-700 overflow-hidden ${className}`}>
    <div className="px-4 py-3 border-b border-dark-700 flex items-center gap-2">
      {icon && <span className="text-xl">{icon}</span>}
      <h2 className="text-lg font-semibold text-white">{title}</h2>
    </div>
    <div className="p-4">
      {children}
    </div>
  </section>
);

// Info row
const InfoRow = ({ label, value, highlight, color }) => (
  <div className="flex flex-col">
    <span className="text-dark-400 text-sm">{label}</span>
    <span className={`${highlight ? 'font-semibold' : ''} ${color || 'text-white'}`}>{value}</span>
  </div>
);

// Timeline item
const TimelineItem = ({ date, label, description, icon, color = 'primary', locale }) => {
  const colors = {
    primary: 'bg-primary-500',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500'
  };

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${colors[color]}`} />
        <div className="w-0.5 flex-1 bg-dark-600" />
      </div>
      <div className="pb-6">
        <div className="flex items-center gap-2 mb-1">
          {icon && <span>{icon}</span>}
          <span className="text-white font-medium">{label}</span>
        </div>
        <div className="text-dark-400 text-sm">{formatDate(date, locale)}</div>
        {description && <div className="text-dark-500 text-sm mt-1">{description}</div>}
      </div>
    </div>
  );
};

export default function ArchiveDetail() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const canEditWeights = hasPermission?.('harvest:edit_weights') ?? false;
  const canEdit = hasPermission?.('archive:edit') ?? hasPermission?.('*') ?? false;
  const canDelete = hasPermission?.('archive:delete') ?? hasPermission?.('*') ?? false;
  const [editWeights, setEditWeights] = useState(false);
  const [weightForm, setWeightForm] = useState({ dryWeight: '', wetWeight: '', trimWeight: '' });
  const [saving, setSaving] = useState(false);

  // Extra nutrition marking
  const [nutritionMode, setNutritionMode] = useState(false);
  const [pendingNutrition, setPendingNutrition] = useState(null);
  const [nutritionSaving, setNutritionSaving] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const qualityLabel = {
    low: t('archive.qualityLow'),
    medium: t('archive.qualityMedium'),
    high: t('archive.qualityHigh'),
    premium: t('archive.qualityPremium')
  };

  const mediumLabel = {
    soil: t('archive.mediumSoilFull'),
    coco: t('archive.mediumCocoFull'),
    hydro: t('archive.mediumHydroFull'),
    aero: t('archive.mediumAeroFull'),
    other: t('archive.mediumOther')
  };

  useEffect(() => {
    if (!id) return;
    archiveService
      .getArchive(id)
      .then(setArchive)
      .catch((err) => {
        setError(err.response?.data?.message || t('archive.archiveNotFound'));
        setArchive(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!archive?.harvestData) return;
    setWeightForm({
      dryWeight: archive.harvestData.dryWeight ?? '',
      wetWeight: archive.harvestData.wetWeight ?? '',
      trimWeight: archive.harvestData.trimWeight ?? ''
    });
  }, [archive]);

  const handleSaveWeights = async (e) => {
    e.preventDefault();
    if (!archive?._id || !canEditWeights) return;
    setSaving(true);
    try {
      const payload = {
        harvestData: {
          dryWeight: weightForm.dryWeight === '' ? undefined : Number(weightForm.dryWeight),
          wetWeight: weightForm.wetWeight === '' ? undefined : Number(weightForm.wetWeight),
          trimWeight: weightForm.trimWeight === '' ? undefined : Number(weightForm.trimWeight)
        }
      };
      const updated = await archiveService.updateArchive(archive._id, payload);
      setArchive(updated);
      setEditWeights(false);
    } catch (err) {
      setError(err.response?.data?.message || t('archive.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!archive?._id) return;
    try {
      await archiveService.deleteArchive(archive._id);
      navigate('/archive');
    } catch (err) {
      setError(err.response?.data?.message || t('archive.deleteError'));
    }
  };

  // Extra nutrition handlers
  const nutritionSet = new Set(
    nutritionMode && pendingNutrition != null
      ? pendingNutrition
      : (archive?.extraNutritionPlants || [])
  );

  const handleToggleNutrition = (plantNumber) => {
    const current = pendingNutrition != null
      ? [...pendingNutrition]
      : [...(archive?.extraNutritionPlants || [])];
    const idx = current.indexOf(plantNumber);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(plantNumber);
    setPendingNutrition(current);
  };

  const handleSaveNutrition = async () => {
    if (!archive?._id || pendingNutrition == null) return;
    setNutritionSaving(true);
    try {
      const updated = await archiveService.updateArchive(archive._id, {
        extraNutritionPlants: pendingNutrition
      });
      setArchive(updated);
      setPendingNutrition(null);
      setNutritionMode(false);
    } catch (err) {
      setError(err.response?.data?.message || t('archive.saveError'));
    } finally {
      setNutritionSaving(false);
    }
  };

  const handleCancelNutrition = () => {
    setPendingNutrition(null);
    setNutritionMode(false);
  };

  const handleStartNutrition = () => {
    setPendingNutrition([...(archive?.extraNutritionPlants || [])]);
    setNutritionMode(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (error && !archive) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-300">{error}</div>
        <Link to="/archive" className="inline-block mt-4 text-primary-400 hover:text-primary-300">
          {t('archive.backToList')}
        </Link>
      </div>
    );
  }

  const h = archive?.harvestData || {};
  const m = archive?.metrics || {};
  const env = archive?.environment || {};
  const veg = archive?.vegData || null;
  const clone = archive?.cloneData || null;
  const light = archive?.lighting || null;
  const tasks = Array.isArray(archive?.completedTasks) ? archive.completedTasks : [];
  const issues = Array.isArray(archive?.issues) ? archive.issues : [];

  const gramsPerSqm = (archive?.squareMeters > 0 && h.dryWeight > 0)
    ? Math.round(h.dryWeight / archive.squareMeters * 100) / 100
    : null;

  // Calculate total cycle duration (from clones to harvest)
  const totalDays = (() => {
    if (clone?.cutDate && archive?.harvestDate) {
      return Math.floor((new Date(archive.harvestDate) - new Date(clone.cutDate)) / (1000 * 60 * 60 * 24));
    }
    return null;
  })();

  // Попкорн и готовый продукт
  const totalPopcorn = (h.popcornWeight || 0) + (h.popcornMachine || 0);
  // finalWeight (ручной ввод) — основной показатель; fallback на trimWeight для старых данных
  const finalProduct = (h.finalWeight || 0) > 0 ? h.finalWeight : (h.trimWeight || 0);
  const popcornPct = totalPopcorn > 0 && finalProduct > 0 ? (totalPopcorn / finalProduct * 100).toFixed(1) : null;

  // Усушка: (wet - finalProduct) / wet * 100
  const shrinkagePct = h.wetWeight > 0 && finalProduct > 0
    ? (((h.wetWeight - finalProduct) / h.wetWeight) * 100).toFixed(1)
    : null;
  // Потери на триме: (dry - finalProduct) / dry * 100
  const trimLossPct = h.dryWeight > 0 && finalProduct > 0
    ? (((h.dryWeight - finalProduct) / h.dryWeight) * 100).toFixed(1)
    : null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/archive" className="text-dark-400 hover:text-white transition">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">
              {localizeRoomName(archive?.roomName, t) || `${t('archive.room')} ${archive?.roomNumber}`}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-primary-400 font-medium">{archive?.strain || t('archive.noStrain')}</span>
              {archive?.cycleName && (
                <span className="text-dark-500">· {archive.cycleName}</span>
              )}
            </div>
          </div>
        </div>
        {canDelete && (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="px-3 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition text-sm"
          >
            {t('archive.deleteBtn')}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-300">{error}</div>
      )}

      {/* Quick Stats */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.dryWeightLabel')}</p>
          <p className="text-green-400 text-2xl font-bold">{formatNum(h.dryWeight, locale)}<span className="text-sm">{t('common.grams')}</span></p>
        </div>
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.gramsPerPlant')}</p>
          <p className="text-blue-400 text-2xl font-bold">{formatNum(m.gramsPerPlant, locale)}</p>
        </div>
        <div className="bg-primary-900/30 border border-primary-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.plantsLabel')}</p>
          <p className="text-primary-400 text-2xl font-bold">{formatNum(archive?.plantsCount, locale)}</p>
        </div>
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.floweringDays')}</p>
          <p className="text-yellow-400 text-2xl font-bold">{formatNum(archive?.actualDays, locale)}</p>
        </div>
        <div className="bg-purple-900/30 border border-purple-700/50 rounded-xl p-4 text-center">
          <p className="text-dark-400 text-sm">{t('archive.qualityLabel')}</p>
          <p className={`text-xl font-bold ${qualityColor[h.quality] || 'text-white'}`}>
            {qualityLabel[h.quality] || h.quality || '—'}
          </p>
        </div>
        {m.gramsPerWatt > 0 && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">{t('archive.gPerWattLabel')}</p>
            <p className="text-amber-400 text-2xl font-bold">{formatNum(m.gramsPerWatt, locale)}</p>
          </div>
        )}
        {gramsPerSqm > 0 && (
          <div className="bg-teal-900/30 border border-teal-700/50 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">{t('archive.gPerSqMLabel')}</p>
            <p className="text-teal-400 text-2xl font-bold">{formatNum(gramsPerSqm, locale)}</p>
          </div>
        )}
        {totalDays && (
          <div className="bg-dark-700/50 border border-dark-600 rounded-xl p-4 text-center">
            <p className="text-dark-400 text-sm">{t('archive.fullCycle')}</p>
            <p className="text-white text-2xl font-bold">{totalDays}<span className="text-sm"> {t('archive.daysLabel')}</span></p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Timeline & Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline */}
          <Section title={t('archive.cycleTimeline')} icon="📅">
            <div className="pl-2">
              {clone?.cutDate && (
                <TimelineItem
                  date={clone.cutDate}
                  label={t('archive.clonesCut')}
                  description={t('archive.clonesPcs', { qty: clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?' })}
                  icon="✂️"
                  color="purple"
                  locale={locale}
                />
              )}
              {veg?.transplantedToVegAt && (
                <TimelineItem
                  date={veg.transplantedToVegAt}
                  label={t('archive.transplantToVeg')}
                  description={[
                    veg.vegPlantsCount ? t('archive.plantsCountN', { count: veg.vegPlantsCount }) : null,
                    veg.vegDaysTarget ? t('archive.planDays', { days: veg.vegDaysTarget }) : null
                  ].filter(Boolean).join(' · ') || null}
                  icon="🌱"
                  color="green"
                  locale={locale}
                />
              )}
              {veg?.transplantedToFlowerAt && (
                <TimelineItem
                  date={veg.transplantedToFlowerAt}
                  label={t('archive.transplantToFlower')}
                  description={[
                    veg.flowerPlantsCount ? t('archive.plantsCountN', { count: veg.flowerPlantsCount }) : null,
                    veg.vegDaysActual ? t('archive.vegDays', { days: veg.vegDaysActual }) : null
                  ].filter(Boolean).join(' · ') || null}
                  icon="🌸"
                  color="yellow"
                  locale={locale}
                />
              )}
              {archive?.startDate && !veg?.transplantedToFlowerAt && (
                <TimelineItem
                  date={archive.startDate}
                  label={t('archive.floweringStart')}
                  icon="🌸"
                  color="yellow"
                  locale={locale}
                />
              )}
              {archive?.harvestDate && (
                <TimelineItem
                  date={archive.harvestDate}
                  label={t('archive.harvestCollection')}
                  description={t('archive.floweringDaysDesc', { days: archive.actualDays })}
                  icon="🌿"
                  color="primary"
                  locale={locale}
                />
              )}
            </div>
          </Section>

          {/* Harvest Data */}
          <Section title={t('archive.harvestSection')} icon="⚖️">
            <div className="flex justify-between items-start mb-4">
              <div />
              {canEditWeights && (
                <button
                  type="button"
                  onClick={() => setEditWeights((v) => !v)}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  {editWeights ? t('archive.editWeightsCancel') : t('archive.editWeights')}
                </button>
              )}
            </div>
            {editWeights ? (
              <form onSubmit={handleSaveWeights} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">{t('archive.wetWeightG')}</label>
                    <input
                      type="number"
                      value={weightForm.wetWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, wetWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">{t('archive.dryWeightG')}</label>
                    <input
                      type="number"
                      value={weightForm.dryWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, dryWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-dark-400 text-sm mb-1">{t('archive.trimWeightG')}</label>
                    <input
                      type="number"
                      value={weightForm.trimWeight}
                      onChange={(e) => setWeightForm((f) => ({ ...f, trimWeight: e.target.value }))}
                      className="w-full bg-dark-800 border border-dark-600 rounded px-3 py-2 text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50"
                >
                  {saving ? t('archive.saving') : t('archive.save')}
                </button>
              </form>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <InfoRow label={t('archive.wetWeightLabel')} value={`${formatNum(h.wetWeight, locale)} ${t('common.grams')}`} />
                <InfoRow label={t('archive.dryWeightLabel')} value={`${formatNum(h.dryWeight, locale)} ${t('common.grams')}`} highlight color="text-green-400" />
                <InfoRow label={t('archive.trimWeightLabel')} value={`${formatNum(h.trimWeight, locale)} ${t('common.grams')}`} />
                {finalProduct > 0 && <InfoRow label={t('trim.finalWeight')} value={`${formatNum(finalProduct, locale)} ${t('common.grams')}`} highlight color="text-emerald-400" />}
                {totalPopcorn > 0 && <InfoRow label={t('trim.popcorn')} value={`${formatNum(totalPopcorn, locale)} ${t('common.grams')}${popcornPct ? ` (${popcornPct}%)` : ''}`} />}
                <InfoRow label={t('archive.gramsPerPlant')} value={formatNum(m.gramsPerPlant, locale)} highlight color="text-primary-400" />
                <InfoRow label={t('archive.gPerDay')} value={formatNum(m.gramsPerDay, locale)} />
                {m.gramsPerWatt > 0 && <InfoRow label={t('archive.gPerWattLabel')} value={formatNum(m.gramsPerWatt, locale)} color="text-amber-400" />}
                {shrinkagePct && <InfoRow label={t('archive.shrinkage')} value={`${shrinkagePct}%`} color="text-red-400" />}
                {trimLossPct && <InfoRow label={t('trim.loss')} value={`${trimLossPct}%`} color="text-orange-400" />}
                <InfoRow
                  label={t('archive.qualityLabel')}
                  value={qualityLabel[h.quality] || h.quality || '—'}
                  color={qualityColor[h.quality]}
                />
                {h.notes && !h.notes.startsWith('Автоархив') && !h.notes.startsWith('Auto-archived') && (
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-dark-400 text-sm">{t('archive.harvestNotes')}</span>
                    <p className="text-dark-300">{h.notes}</p>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Карта сбора (тепловая) */}
          {archive?.harvestMapData?.plants?.length > 0 && (
            <Section title={t('archive.harvestMap')} icon="🗺️">
              <ArchiveHeatMap
                harvestMapData={archive.harvestMapData}
                extraNutritionPlants={nutritionSet}
                extraNutritionMode={nutritionMode}
                onExtraNutritionToggle={handleToggleNutrition}
              />
              {/* Nutrition markup controls */}
              {canEdit && (
                <div className="mt-4 pt-3 border-t border-dark-700">
                  {nutritionMode ? (
                    <div className="flex items-center justify-between bg-yellow-500/10 rounded-lg px-4 py-2 border border-yellow-500/30">
                      <span className="text-sm font-medium text-yellow-300">
                        🧪 {t('harvest.extraNutrition')}: {t('harvest.extraNutritionSelectOnMap')} ({nutritionSet.size} {t('common.pcs')})
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSaveNutrition}
                          disabled={nutritionSaving}
                          className="px-4 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-sm transition disabled:opacity-50"
                        >
                          {t('harvest.extraNutritionSave')}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelNutrition}
                          className="px-3 py-1.5 text-dark-400 hover:text-white transition text-sm"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartNutrition}
                      className={`text-sm transition flex items-center gap-1.5 ${
                        archive?.extraNutritionPlants?.length
                          ? 'text-yellow-400 hover:text-yellow-300'
                          : 'text-dark-400 hover:text-yellow-400'
                      }`}
                    >
                      <span>🧪</span>
                      {archive?.extraNutritionPlants?.length
                        ? `${t('harvest.extraNutrition')} (${archive.extraNutritionPlants.length} ${t('common.pcs')})`
                        : t('harvest.extraNutritionMark')
                      }
                    </button>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Extra nutrition detailed report */}
          {archive?.extraNutritionPlants?.length > 0 && archive?.harvestMapData?.plants?.length > 0 && (() => {
            const extraSet = new Set(archive.extraNutritionPlants);
            const plantsWithWeight = archive.harvestMapData.plants.filter(p => p.wetWeight > 0);
            const withNutr = plantsWithWeight.filter(p => extraSet.has(p.plantNumber)).sort((a, b) => b.wetWeight - a.wetWeight);
            const withoutNutr = plantsWithWeight.filter(p => !extraSet.has(p.plantNumber)).sort((a, b) => b.wetWeight - a.wetWeight);

            const calcGroup = (arr) => {
              if (!arr.length) return { avg: 0, median: 0, min: 0, max: 0, total: 0, count: 0 };
              const w = arr.map(p => p.wetWeight).sort((a, b) => a - b);
              const total = w.reduce((s, v) => s + v, 0);
              const median = w.length % 2 === 0
                ? Math.round((w[w.length / 2 - 1] + w[w.length / 2]) / 2)
                : w[Math.floor(w.length / 2)];
              return { avg: Math.round(total / w.length), median, min: w[0], max: w[w.length - 1], total, count: w.length };
            };

            const sWith = calcGroup(withNutr);
            const sWithout = calcGroup(withoutNutr);
            const diff = sWith.avg - sWithout.avg;
            const diffPct = sWithout.avg > 0 ? ((diff / sWithout.avg) * 100).toFixed(1) : '0.0';
            const diffPositive = diff > 0;
            const medianDiff = sWith.median - sWithout.median;
            const medianDiffPct = sWithout.median > 0 ? ((medianDiff / sWithout.median) * 100).toFixed(1) : '0.0';

            return (
              <Section title={t('archive.nutritionReport')} icon="🧪">
                <div className="flex justify-end mb-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setPdfGenerating(true);
                      try {
                        await generateNutritionPDF(archive, t, locale);
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setPdfGenerating(false);
                      }
                    }}
                    disabled={pdfGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-900/50 text-primary-400 hover:bg-primary-800/50 rounded-lg text-sm transition disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {pdfGenerating ? t('archive.saving') : 'PDF'}
                  </button>
                </div>
                <div className="space-y-5">
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4 text-center">
                      <div className="text-xs text-dark-400 mb-1">{t('harvest.withNutrition')}</div>
                      <div className="text-2xl font-bold text-yellow-400">{formatNum(sWith.avg, locale)}<span className="text-sm"> {t('common.grams')}</span></div>
                      <div className="text-xs text-dark-500 mt-0.5">{sWith.count} {t('common.pcs')} · Σ{formatNum(sWith.total, locale)}{t('common.grams')}</div>
                    </div>
                    <div className="bg-dark-700/50 border border-dark-600 rounded-xl p-4 text-center">
                      <div className="text-xs text-dark-400 mb-1">{t('harvest.withoutNutrition')}</div>
                      <div className="text-2xl font-bold text-dark-200">{formatNum(sWithout.avg, locale)}<span className="text-sm"> {t('common.grams')}</span></div>
                      <div className="text-xs text-dark-500 mt-0.5">{sWithout.count} {t('common.pcs')} · Σ{formatNum(sWithout.total, locale)}{t('common.grams')}</div>
                    </div>
                    <div className={`${diffPositive ? 'bg-green-900/20 border-green-700/30' : diff < 0 ? 'bg-red-900/20 border-red-700/30' : 'bg-dark-700/50 border-dark-600'} border rounded-xl p-4 text-center`}>
                      <div className="text-xs text-dark-400 mb-1">{t('harvest.difference')}</div>
                      <div className={`text-2xl font-bold ${diffPositive ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-dark-300'}`}>
                        {diffPositive ? '+' : ''}{formatNum(diff, locale)}<span className="text-sm"> {t('common.grams')}</span>
                      </div>
                      <div className={`text-sm font-medium mt-0.5 ${diffPositive ? 'text-green-500' : diff < 0 ? 'text-red-500' : 'text-dark-500'}`}>
                        {diffPositive ? '+' : ''}{diffPct}%
                      </div>
                    </div>
                  </div>

                  {/* Detailed metrics table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-dark-400 border-b border-dark-700">
                          <th className="text-left py-2 pr-3 font-medium">{t('archive.metric')}</th>
                          <th className="text-right py-2 px-3 font-medium text-yellow-400">🧪 {t('harvest.withNutrition')}</th>
                          <th className="text-right py-2 px-3 font-medium">{t('harvest.withoutNutrition')}</th>
                          <th className="text-right py-2 pl-3 font-medium">{t('harvest.difference')}</th>
                        </tr>
                      </thead>
                      <tbody className="text-dark-200">
                        <tr className="border-b border-dark-700/50">
                          <td className="py-2 pr-3 text-dark-400">{t('archive.plantsLabel')}</td>
                          <td className="text-right py-2 px-3 text-yellow-300 font-medium">{sWith.count}</td>
                          <td className="text-right py-2 px-3">{sWithout.count}</td>
                          <td className="text-right py-2 pl-3 text-dark-500">—</td>
                        </tr>
                        <tr className="border-b border-dark-700/50">
                          <td className="py-2 pr-3 text-dark-400">{t('archive.avgWeightLabel')}</td>
                          <td className="text-right py-2 px-3 text-yellow-300 font-medium">{formatNum(sWith.avg, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 px-3">{formatNum(sWithout.avg, locale)}{t('common.grams')}</td>
                          <td className={`text-right py-2 pl-3 font-medium ${diffPositive ? 'text-green-400' : diff < 0 ? 'text-red-400' : ''}`}>
                            {diffPositive ? '+' : ''}{formatNum(diff, locale)}{t('common.grams')} ({diffPositive ? '+' : ''}{diffPct}%)
                          </td>
                        </tr>
                        <tr className="border-b border-dark-700/50">
                          <td className="py-2 pr-3 text-dark-400">{t('archive.medianLabel')}</td>
                          <td className="text-right py-2 px-3 text-yellow-300">{formatNum(sWith.median, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 px-3">{formatNum(sWithout.median, locale)}{t('common.grams')}</td>
                          <td className={`text-right py-2 pl-3 ${medianDiff > 0 ? 'text-green-400' : medianDiff < 0 ? 'text-red-400' : ''}`}>
                            {medianDiff > 0 ? '+' : ''}{formatNum(medianDiff, locale)}{t('common.grams')} ({medianDiff > 0 ? '+' : ''}{medianDiffPct}%)
                          </td>
                        </tr>
                        <tr className="border-b border-dark-700/50">
                          <td className="py-2 pr-3 text-dark-400">{t('archive.minWeightLabel')}</td>
                          <td className="text-right py-2 px-3 text-yellow-300">{formatNum(sWith.min, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 px-3">{formatNum(sWithout.min, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 pl-3 text-dark-500">—</td>
                        </tr>
                        <tr className="border-b border-dark-700/50">
                          <td className="py-2 pr-3 text-dark-400">{t('archive.maxWeightLabel')}</td>
                          <td className="text-right py-2 px-3 text-yellow-300">{formatNum(sWith.max, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 px-3">{formatNum(sWithout.max, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 pl-3 text-dark-500">—</td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-3 text-dark-400 font-medium">{t('archive.totalWeightLabel')}</td>
                          <td className="text-right py-2 px-3 text-yellow-300 font-medium">{formatNum(sWith.total, locale)}{t('common.grams')}</td>
                          <td className="text-right py-2 px-3 font-medium">{formatNum(sWithout.total, locale)}{t('common.grams')}</td>
                          <td className={`text-right py-2 pl-3 font-medium ${sWith.total - sWithout.total > 0 ? 'text-green-400' : ''}`}>
                            Σ{formatNum(sWith.total + sWithout.total, locale)}{t('common.grams')}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Per-plant weight lists */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-xs text-yellow-400 font-medium uppercase tracking-wider mb-2">
                        🧪 {t('harvest.withNutrition')} ({sWith.count})
                      </h4>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        {withNutr.map((p, i) => (
                          <div key={i} className="flex justify-between text-xs py-1 px-2 rounded hover:bg-dark-700/30">
                            <span className="text-dark-400">#{p.plantNumber}{p.strain ? ` · ${p.strain}` : ''}</span>
                            <span className="text-yellow-300 font-medium">{formatNum(p.wetWeight, locale)}{t('common.grams')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs text-dark-400 font-medium uppercase tracking-wider mb-2">
                        {t('harvest.withoutNutrition')} ({sWithout.count})
                      </h4>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        {withoutNutr.map((p, i) => (
                          <div key={i} className="flex justify-between text-xs py-1 px-2 rounded hover:bg-dark-700/30">
                            <span className="text-dark-400">#{p.plantNumber}{p.strain ? ` · ${p.strain}` : ''}</span>
                            <span className="text-dark-200">{formatNum(p.wetWeight, locale)}{t('common.grams')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Conclusion */}
                  <div className={`rounded-lg px-4 py-3 ${diffPositive ? 'bg-green-900/20 border border-green-700/30' : diff < 0 ? 'bg-red-900/20 border border-red-700/30' : 'bg-dark-700/50 border border-dark-600'}`}>
                    <p className={`text-sm ${diffPositive ? 'text-green-300' : diff < 0 ? 'text-red-300' : 'text-dark-300'}`}>
                      {diffPositive
                        ? t('archive.nutritionPositive', { pct: diffPct, grams: diff })
                        : diff < 0
                          ? t('archive.nutritionNegative', { pct: Math.abs(parseFloat(diffPct)).toFixed(1), grams: Math.abs(diff) })
                          : t('archive.nutritionNeutral')
                      }
                    </p>
                  </div>
                </div>
              </Section>
            );
          })()}

          {/* Команда сбора */}
          {archive?.crewData?.members?.length > 0 && (
            <Section title={t('archive.crewSection')} icon="👥">
              <CrewInfographic
                crewData={archive.crewData}
                roomSquareMeters={archive.squareMeters}
                roomName={localizeRoomName(archive.roomName, t)}
                strain={archive.strain}
                embedded
              />
            </Section>
          )}

          {/* Completed Tasks */}
          {tasks.length > 0 && (
            <Section title={t('archive.completedTasks', { count: tasks.length })} icon="✅">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {tasks.map((tk, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 text-sm py-2 border-b border-dark-700 last:border-0">
                    <span className="px-2 py-0.5 bg-primary-900/50 text-primary-400 rounded text-xs">
                      {tk.type || t('archive.taskLabel')}
                    </span>
                    <span className="text-white">{tk.title}</span>
                    {tk.dayOfCycle && (
                      <span className="text-dark-500">{t('archive.dayOfCycle', { day: tk.dayOfCycle })}</span>
                    )}
                    {tk.completedAt && (
                      <span className="text-dark-500">{formatDateTime(tk.completedAt, locale)}</span>
                    )}
                    {tk.completedBy?.name && (
                      <span className="text-dark-400">({tk.completedBy.name})</span>
                    )}
                    {tk.sprayProduct && (
                      <span className="text-blue-400 text-xs">🧪 {tk.sprayProduct}</span>
                    )}
                    {tk.feedProduct && (
                      <span className="text-green-400 text-xs">🌿 {tk.feedProduct} {tk.feedDosage}</span>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Issues */}
          {issues.length > 0 && (
            <Section title={t('archive.issuesInCycle')} icon="⚠️">
              <div className="space-y-2">
                {issues.map((iss, i) => (
                  <div key={i} className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-red-900/50 text-red-400 rounded text-xs">
                        {iss.type || t('archive.issueLabel')}
                      </span>
                      {iss.resolvedAt && (
                        <span className="px-2 py-0.5 bg-green-900/50 text-green-400 rounded text-xs">
                          {t('archive.resolved')}
                        </span>
                      )}
                    </div>
                    <p className="text-dark-300">{iss.description || '—'}</p>
                    {iss.solution && (
                      <p className="text-dark-400 text-sm mt-1">{t('archive.solutionLabel', { solution: iss.solution })}</p>
                    )}
                    <div className="text-dark-500 text-xs mt-1">
                      {iss.resolvedAt
                        ? t('archive.detectedAndResolved', { detected: formatDate(iss.detectedAt, locale), resolved: formatDate(iss.resolvedAt, locale) })
                        : t('archive.detectedAt', { date: formatDate(iss.detectedAt, locale) })
                      }
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Right column - Info cards */}
        <div className="space-y-6">
          {/* Clone Data */}
          {clone && (
            <Section title={t('archive.clonesSection')} icon="✂️">
              <div className="space-y-3">
                <InfoRow label={t('archive.cutDate')} value={formatDate(clone.cutDate, locale)} />
                <InfoRow
                  label={t('archive.quantity')}
                  value={t('archive.clonesPcs', { qty: clone.quantity || clone.strains?.reduce((s, x) => s + (x.quantity || 0), 0) || '?' })}
                />
                {clone.strains?.length > 0 && (
                  <div>
                    <span className="text-dark-400 text-sm">{t('archive.strainsLabel')}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {clone.strains.map((s, i) => (
                        <span key={i} className="px-2 py-1 bg-purple-900/50 text-purple-400 rounded text-xs">
                          {s.strain}: {s.quantity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {clone.notes && (
                  <div>
                    <span className="text-dark-400 text-sm">{t('archive.notesLabel')}</span>
                    <p className="text-dark-300 text-sm">{clone.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Veg Data */}
          {veg && (
            <Section title={t('archive.vegSection')} icon="🌱">
              <div className="space-y-3">
                <InfoRow label={t('archive.vegStart')} value={formatDate(veg.transplantedToVegAt, locale)} />
                {veg.vegPlantsCount > 0 && (
                  <InfoRow label={t('archive.plantsToVeg')} value={t('archive.clonesPcs', { qty: veg.vegPlantsCount })} />
                )}
                <InfoRow label={t('archive.toFlower')} value={formatDate(veg.transplantedToFlowerAt, locale)} />
                {veg.flowerPlantsCount > 0 && (
                  <InfoRow label={t('archive.plantsToFlower')} value={t('archive.clonesPcs', { qty: veg.flowerPlantsCount })} highlight color="text-primary-400" />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label={t('archive.planLabel')} value={t('archive.daysValue', { days: veg.vegDaysTarget || '—' })} />
                  <InfoRow
                    label={t('archive.factLabel')}
                    value={t('archive.daysValue', { days: veg.vegDaysActual || '—' })}
                    highlight
                    color="text-green-400"
                  />
                </div>
                {veg.notes && (
                  <div>
                    <span className="text-dark-400 text-sm">{t('archive.notesLabel')}</span>
                    <p className="text-dark-300 text-sm">{veg.notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Lighting & Room */}
          {(light?.totalWatts || archive?.squareMeters) && (
            <Section title={t('archive.lightingAndRoom')} icon="💡">
              <div className="space-y-3">
                {archive?.squareMeters > 0 && (
                  <InfoRow label={t('archive.greenArea')} value={t('archive.sqMeters', { area: archive.squareMeters })} />
                )}
                {light?.lampCount > 0 && (
                  <InfoRow label={t('archive.lampsLabel')} value={t('archive.lampsInfo', { count: light.lampCount, wattage: light.lampWattage || '?' })} />
                )}
                {light?.lampType && (
                  <InfoRow label={t('archive.lampType')} value={light.lampType} />
                )}
                {m.gramsPerWatt > 0 && (
                  <InfoRow label={t('archive.gPerWattLabel')} value={formatNum(m.gramsPerWatt, locale)} highlight color="text-amber-400" />
                )}
                {gramsPerSqm > 0 && (
                  <InfoRow label={t('archive.gPerSqMLabel')} value={formatNum(gramsPerSqm, locale)} highlight color="text-teal-400" />
                )}
              </div>
            </Section>
          )}

          {/* Environment */}
          <Section title={t('archive.conditionsSection')} icon="🌡️">
            <div className="space-y-3">
              <InfoRow label={t('archive.lightSchedule')} value={t('archive.lightScheduleVal', { hours: env.lightHours || 12 })} />
              <InfoRow label={t('archive.substrate')} value={mediumLabel[env.medium] || env.medium || '—'} />
              {env.avgTemperature && (
                <InfoRow label={t('archive.avgTemp')} value={t('archive.avgTempVal', { temp: env.avgTemperature })} />
              )}
              {env.avgHumidity && (
                <InfoRow label={t('archive.avgHumidity')} value={t('archive.avgHumidityVal', { humidity: env.avgHumidity })} />
              )}
              {env.nutrients && (
                <div>
                  <span className="text-dark-400 text-sm">{t('archive.fertilizers')}</span>
                  <p className="text-dark-300 text-sm">{env.nutrients}</p>
                </div>
              )}
            </div>
          </Section>

          {/* Cycle Dates */}
          <Section title={t('archive.cycleDates')} icon="📆">
            <div className="space-y-3">
              <InfoRow label={t('archive.floweringStartDate')} value={formatDate(archive?.startDate, locale)} />
              <InfoRow label={t('archive.plannedHarvest')} value={t('archive.daysValue', { days: archive?.floweringDays || '—' })} />
              <InfoRow label={t('archive.actualHarvest')} value={formatDate(archive?.harvestDate, locale)} />
              <InfoRow
                label={t('archive.actualDays')}
                value={t('archive.daysValue', { days: archive?.actualDays || '—' })}
                highlight
              />
            </div>
          </Section>

          {/* Notes */}
          {archive?.notes && (
            <Section title={t('archive.generalNotes')} icon="📝">
              <p className="text-dark-300 whitespace-pre-wrap">{archive.notes}</p>
            </Section>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl p-6 max-w-md w-full border border-dark-700">
            <h3 className="text-xl font-bold text-white mb-4">{t('archive.deleteArchiveTitle')}</h3>
            <p className="text-dark-300 mb-6">
              {t('archive.deleteArchiveMsg', {
                room: localizeRoomName(archive?.roomName, t) || `${t('archive.room')} ${archive?.roomNumber}`,
                strain: archive?.strain
              })}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 text-dark-300 hover:text-white transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
