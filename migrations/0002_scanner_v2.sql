ALTER TABLE searches ADD COLUMN category_id TEXT;
ALTER TABLE searches ADD COLUMN profile_key TEXT;

DELETE FROM searches;

INSERT INTO searches (
  id, name, query, max_price, enabled,
  category_id, profile_key
)
VALUES
  (101, 'Business Laptops', 'laptop', 300, 1, '175672', 'Business Laptops'),
  (102, 'Mini PCs', 'mini pc', 200, 1, '171957', 'Mini PCs'),
  (103, 'Game Consoles', 'console', 250, 1, '139971', 'Game Consoles'),
  (104, 'Projectors', 'projector', 180, 1, '22610', 'Projectors'),
  (105, 'Premium Audio', 'speaker', 180, 1, '111694', 'Premium Audio'),
  (106, 'Label Printers', 'label printer', 220, 1, '25348', 'Label Printers')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  query = excluded.query,
  max_price = excluded.max_price,
  enabled = 1,
  category_id = excluded.category_id,
  profile_key = excluded.profile_key;
