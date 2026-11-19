// Starting data, taken from Receipt Format02.xlsx (week of 20.11.2026).
// Only used the first time the app runs; everything can be edited in the app afterwards.

const settings = {
  company_name: 'DAILY FRESHER LTD',
  company_tagline: 'Dealer in Local and Imported Vegetables & Fruits',
  company_address: 'Branch Road, Meetoo Lane, Bon Accueil',
  company_phone: '54280199',
  company_emails: 'dailyfresher@outlook.com, oorvi28@gmail.com',
  company_brn: 'C22188745',
  customer_name: 'GAMMA CONSTRUCTION LTD',
  note: 'Note: Goods once sold and delivered are not refundable.',
  acknowledgment: 'Acknowledgment: all goods are received in good condition.',
  signature_labels: ['Driver Signature', 'Received By Cook', 'Signature', 'Signature'],
  footer_text: 'Payment due monthly · Thank you for your business',
  show_footer: true,
  show_part_payment: true,
  print_copy: true,
  color: '#14a9e8',
  // Where numbering continues from (last invoices made in Excel)
  last_df: 502,
  last_inv: 353,
  last_date: '2026-11-20',
};

// [no, receipt name, statement name, usual vehicle]
const dorms = [
  [1, 'Belle-Vue', 'Belle-Vue', '9528 JU 2025'],
  [2, "Poudre D'Or", "Poudre D'Or", '9528 JU 2025'],
  [3, 'Petit-Raffray', 'Petit Raffray', '9528 JU 2025'],
  [4, 'Long Mountain Nepalese', 'Valton', '9828 SP 2026'],
  [5, 'Long Mountain Bangladesh', 'Long Mountain', '9828 SP 2026'],
  [6, 'Coromandel', 'Coromandel', '9528 JU 2025'],
  [7, 'Chebel', 'Chebel', '9528 JU 2025'],
  [8, 'New-Grove', 'New-Grove', '9528 JU 2025'],
  [9, 'Floreal', 'Floreal', '9528 JU 2025'],
];

// [code, name, unit, series, price]
const products = [
  ['Veg-PdAmo', "Pomme D'Amour", 'Kg', 'DF', 50],
  ['Veg-PdAmo1', "Pomme D'Amour 1", 'Kg', 'DF', 0],
  ['Veg-PdAmo2', "Pomme D'Amour 2", 'Kg', 'DF', 0],
  ['Veg-PdAmo3', "Pomme D'Amour 3", 'Kg', 'DF', 0],
  ['Veg-PdAmo4', "Pomme D'Amour 4", 'Kg', 'DF', 0],
  ['Veg-Tom', 'Tomate', 'Kg', 'DF', 0],
  ['Veg-Concom', 'Concombre Vert', 'Pcs', 'DF', 45],
  ['Veg-ConBl', 'Concombre Blanc', 'Pcs', 'DF', 0],
  ['Veg-Courg', 'Courgette', 'Pcs', 'DF', 70],
  ['Veg-Patis', 'Patisson', 'Kg', 'DF', 0],
  ['Veg-Pipen', 'Pipengaille', 'Kg', 'DF', 75],
  ['Veg-Patol', 'Patole', 'Kg', 'DF', 0],
  ['Veg-Hari', 'Haricot Tan', 'Kg', 'DF', 110],
  ['Veg-Voem', 'Voem', 'Kg', 'DF', 155],
  ['Veg-Cale', 'Calebasse', 'Kg', 'DF', 70],
  ['Veg-Marg', 'Margoze', 'Kg', 'DF', 150],
  ['Veg-Lalo', 'Lalo', 'Kg', 'DF', 0],
  ['Veg-Brin', 'Bringelle', 'Kg', 'DF', 60],
  ['Veg-Chou', 'Chouchou', 'Kg', 'DF', 60],
  ['Veg-GPim', 'Gros Piment', 'Kg', 'DF', 0],
  ['Veg-Carot', 'Carotte', 'Kg', 'DF', 0],
  ['Veg-Girau', 'Giraumon', 'Kg', 'DF', 60],
  ['Veg-Rav', 'Rave', 'Kg', 'DF', 70],
  ['Veg-Thym', 'Du Thym', 'Bundle', 'DF', 0],
  ['Veg-PoivRJ', 'Poivron Rouge/Jaune', 'Kg', 'DF', 0],
  ['Veg-PoivV', 'Poivron Vert', 'Kg', 'DF', 0],
  ['Veg-lecho', 'Le Choux', 'Kg', 'DF', 90],
  ['Veg-Pet', 'Petsai', 'Kg', 'DF', 85],
  ['Veg-Chfl', 'Choufleur', 'Kg', 'DF', 0],
  ['Veg-Pvert', 'Piment Vert', 'Kg', 'DF', 170],
  ['Veg-Oni', 'Onions', 'Kg', 'INV', 50],
  ['Veg-PDT', 'Pomme de Terre', 'Kg', 'INV', 50],
];

module.exports = { settings, dorms, products };
