export const generateHTMLTable = (rows) => {
  let previousProjectNumber = null;

  const tableRows = rows
    .map((row) => {
      const isNewProjectNumber = row.project_number !== previousProjectNumber;
      previousProjectNumber = row.project_number;

      return `
        ${
          isNewProjectNumber
            ? `<tr><td colspan="4" style="border-bottom: 2px solid #e2e8f0;"></td></tr>`
            : ""
        }
        <tr style="border-bottom: 1px solid #e2e8f0; background: white;">
          <td style="padding: 12px 16px;">${row.project_number}</td>
          <td style="padding: 12px 16px;">${row.item_sku}</td>
          <td style="padding: 12px 16px;">${row.item_name}</td>
          <td style="padding: 12px 16px; text-align: right;">${parseInt(
            row.total_quantity,
            10
          ).toLocaleString()}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="width: 100%; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="background: #f7fafc; border-bottom: 1px solid #e2e8f0;">
            <th style="padding: 12px 16px; font-size: 12px; text-transform: uppercase; cursor: pointer; color: #4a5568;">Project Number</th>
            <th style="padding: 12px 16px; font-size: 12px; text-transform: uppercase; cursor: pointer; color: #4a5568;">SKU</th>
            <th style="padding: 12px 16px; font-size: 12px; text-transform: uppercase; cursor: pointer; color: #4a5568;">Item Name</th>
            <th style="padding: 12px 16px; font-size: 12px; text-transform: uppercase; cursor: pointer; color: #4a5568; text-align: right;">Total Quantity</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
};
