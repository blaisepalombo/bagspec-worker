import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import 'deals_screen.dart';
import 'forms.dart';

const _statusOptions = [
  ('purchased', 'Bought'),
  ('repairing', 'Repairing'),
  ('listed', 'Listed for sale'),
  ('failed', 'Could not fix (count as a loss)'),
];

Future<void> openEbayLink(BuildContext context, String? link) async {
  final url = Uri.tryParse(link ?? '');
  final ok = url != null && url.scheme == 'https' && (url.host == 'ebay.com' || url.host.endsWith('.ebay.com')) &&
      await launchUrl(url, mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open eBay.')));
  }
}

class FlipsScreen extends StatefulWidget {
  const FlipsScreen({super.key, required this.api});
  final BagSpecApi api;

  @override
  State<FlipsScreen> createState() => FlipsScreenState();
}

class FlipsScreenState extends State<FlipsScreen> with WidgetsBindingObserver {
  Inventory? _inventory;
  EbayStatus? _ebay;
  String? _error;
  bool _ebayBusy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Coming back from Safari after connecting eBay picks up the new status.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) refresh();
  }

  Future<void> refresh() async {
    try {
      final results = await Future.wait([
        widget.api.inventory(),
        widget.api.ebayStatus().then<EbayStatus?>((s) => s).catchError((_) => null),
      ]);
      if (mounted) {
        setState(() {
          _inventory = results[0] as Inventory;
          _ebay = results[1] as EbayStatus?;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  void _toast(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _ebayAction(Future<void> Function() action, {String? done}) async {
    setState(() => _ebayBusy = true);
    try {
      await action();
      if (done != null) _toast(done);
    } on ApiException catch (error) {
      _toast(error.message);
    } finally {
      await refresh();
      if (mounted) setState(() => _ebayBusy = false);
    }
  }

  Future<void> _connectEbay() async {
    try {
      final url = await widget.api.ebayConnectUrl();
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } on ApiException catch (error) {
      _toast(error.message);
    }
  }

  Future<void> _addManual() async {
    final saved = await showFormSheet(context,
        title: 'Add an item',
        submitLabel: 'Add item',
        fields: const [
          FormFieldSpec('itemName', 'What is it?', required: true, hint: 'e.g. Nintendo 3DS XL, broken hinge'),
          FormFieldSpec('purchasePrice', 'Price paid', money: true, required: true),
          FormFieldSpec('inboundShipping', 'Shipping paid', money: true, initial: '0'),
          FormFieldSpec('salesTax', 'Sales tax', money: true, hint: 'Blank = estimate 6%. 0 for cash buys.'),
          FormFieldSpec('partsCost', 'Parts bought so far', money: true),
          FormFieldSpec('notes', 'Notes', hint: 'e.g. Facebook Marketplace, Rexburg'),
        ],
        onSubmit: (v) => widget.api.addFlip(
              itemName: v['itemName'] as String,
              purchasePrice: v['purchasePrice'] as double,
              inboundShipping: v['inboundShipping'] as double?,
              salesTax: v['salesTax'] as double?,
              partsCost: v['partsCost'] as double?,
              notes: v['notes'] as String?,
            ));
    if (saved) await refresh();
  }

  Future<void> _openFlip(Flip flip) async {
    final orderLink = _ebay?.orderLinks[flip.id];
    final changed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: BagSpecColors.surface,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            title: Text(flip.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('${flip.statusLabel} · ${money(flip.cost)} spent'),
          ),
          const Divider(height: 1),
          if (orderLink != null)
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('View eBay order'),
              onTap: () => openEbayLink(sheet, orderLink),
            ),
          if (flip.itemUrl != null)
            ListTile(
              leading: const Icon(Icons.open_in_new),
              title: const Text('View original listing'),
              onTap: () => openEbayLink(sheet, flip.itemUrl),
            ),
          ListTile(
            leading: const Icon(Icons.edit_outlined),
            title: const Text('Update costs or status'),
            onTap: () async => Navigator.of(sheet).pop(await _edit(flip)),
          ),
          if (!flip.sold)
            ListTile(
              leading: const Icon(Icons.sell_outlined, color: BagSpecColors.green),
              title: const Text('Mark sold'),
              onTap: () async => Navigator.of(sheet).pop(await _markSold(flip)),
            ),
          ListTile(
            leading: const Icon(Icons.delete_outline, color: BagSpecColors.red),
            title: const Text('Delete', style: TextStyle(color: BagSpecColors.red)),
            onTap: () async => Navigator.of(sheet).pop(await _delete(flip)),
          ),
        ])),
      ),
    );
    if (changed == true) await refresh();
  }

  Future<bool> _edit(Flip flip) => showFormSheet(context,
      title: 'Update ${flip.name}',
      submitLabel: 'Save',
      fields: [
        FormFieldSpec('status', 'Status',
            initial: flip.status, options: [..._statusOptions, if (flip.sold) ('sold', 'Sold')]),
        FormFieldSpec('partsCost', 'Total spent on parts', money: true, initial: moneyText(flip.partsCost)),
        FormFieldSpec('packingCost', 'Packing supplies', money: true, initial: moneyText(flip.packingCost)),
        FormFieldSpec('purchasePrice', 'Price paid', money: true, initial: moneyText(flip.purchasePrice)),
        FormFieldSpec('inboundShipping', 'Shipping paid', money: true, initial: moneyText(flip.inboundShipping)),
        FormFieldSpec('notes', 'Notes', initial: flip.notes),
      ],
      // An unchanged status is left out: re-sending "sold" would ask for
      // the sale price again.
      onSubmit: (v) => widget.api.updateFlip(flip.id, {...v}..removeWhere((k, value) => k == 'status' && value == flip.status)));

  Future<bool> _markSold(Flip flip) => showFormSheet(context,
      title: 'Mark sold: ${flip.name}',
      submitLabel: 'Mark sold',
      fields: const [
        FormFieldSpec('salePrice', 'Sold for', money: true, required: true, hint: 'On eBay, what the buyer paid incl. shipping'),
        FormFieldSpec('saleChannel', 'Sold on', options: [('eBay', 'eBay'), ('Local', 'Locally'), ('Other', 'Somewhere else')]),
        FormFieldSpec('outboundShipping', 'Shipping you paid', money: true, hint: 'Label cost, if any'),
      ],
      onSubmit: (v) => widget.api.markFlipSold(flip.id,
          salePrice: v['salePrice'] as double,
          channel: v['saleChannel'] as String,
          outboundShipping: v['outboundShipping'] as double?));

  Future<bool> _delete(Flip flip) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Delete this item?'),
        content: Text('${flip.name} will be removed from My flips. This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.of(dialog).pop(true),
              child: const Text('Delete', style: TextStyle(color: BagSpecColors.red))),
        ],
      ),
    );
    if (sure != true) return false;
    try {
      await widget.api.deleteFlip(flip.id);
      return true;
    } on ApiException catch (error) {
      _toast(error.message);
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final inventory = _inventory;
    return Scaffold(
      appBar: AppBar(title: const Text('My flips')),
      floatingActionButton: inventory == null
          ? null
          : FloatingActionButton.extended(onPressed: _addManual, icon: const Icon(Icons.add), label: const Text('Add an item')),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: inventory == null
            ? ListView(children: [
                const SizedBox(height: 120),
                Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!)),
              ])
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                children: [
                  Row(children: [
                    Expanded(child: _Metric(label: 'Profit so far', value: money(inventory.totalProfit),
                        color: inventory.totalProfit < 0 ? BagSpecColors.red : BagSpecColors.green)),
                    const SizedBox(width: 10),
                    Expanded(child: _Metric(label: 'Money tied up', value: money(inventory.moneyTiedUp),
                        sub: '${inventory.open} not sold yet')),
                  ]),
                  const SizedBox(height: 12),
                  if (_ebay != null) _EbayPanel(
                    status: _ebay!,
                    busy: _ebayBusy,
                    onConnect: _connectEbay,
                    onSync: () => _ebayAction(widget.api.ebaySyncNow, done: 'Checked eBay for new purchases.'),
                    onAdd: (p) => _ebayAction(() => widget.api.ebayAddPurchase(p.orderLineId), done: 'Added to My flips.'),
                    onHide: (p) => _ebayAction(() => widget.api.ebayHidePurchase(p.orderLineId)),
                  ),
                  const SizedBox(height: 12),
                  if (inventory.items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 40),
                      child: Text('No flips yet. Tap "I bought this" on a deal, or "Add an item".',
                          textAlign: TextAlign.center, style: TextStyle(color: BagSpecColors.muted)),
                    ),
                  for (final flip in inventory.items) ...[
                    _FlipTile(flip: flip, onTap: () => _openFlip(flip)),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
      ),
    );
  }
}

class _EbayPanel extends StatelessWidget {
  const _EbayPanel({
    required this.status,
    required this.busy,
    required this.onConnect,
    required this.onSync,
    required this.onAdd,
    required this.onHide,
  });
  final EbayStatus status;
  final bool busy;
  final VoidCallback onConnect;
  final VoidCallback onSync;
  final void Function(EbayPurchase) onAdd;
  final void Function(EbayPurchase) onHide;

  @override
  Widget build(BuildContext context) {
    final String heading;
    final String detail;
    final Widget action;
    if (!status.connected || status.needsReconnect) {
      heading = status.needsReconnect ? 'eBay needs to be connected again' : 'Connect your eBay account';
      detail = status.needsReconnect
          ? (status.lastSyncError ?? 'The eBay sign-in stopped working.')
          : 'BagSpec checks what you buy on eBay once an hour and adds BagSpec deals to My flips automatically.';
      action = status.configured
          ? FilledButton(onPressed: onConnect, child: Text(status.needsReconnect ? 'Connect eBay again' : 'Connect eBay'))
          : const Text('Needs the eBay RuName set up first.', style: TextStyle(color: BagSpecColors.muted));
    } else {
      heading = 'eBay connected';
      final checked = status.lastSyncAt == null
          ? 'Not checked yet'
          : 'Last checked ${MaterialLocalizations.of(context).formatShortMonthDay(status.lastSyncAt!)} '
              '${TimeOfDay.fromDateTime(status.lastSyncAt!).format(context)}';
      detail = status.lastSyncError == null ? checked : '$checked · Problem: ${status.lastSyncError}';
      action = OutlinedButton(onPressed: busy ? null : onSync, child: Text(busy ? 'Checking…' : 'Check now'));
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(heading, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(detail, style: const TextStyle(color: BagSpecColors.muted, fontSize: 13)),
          const SizedBox(height: 10),
          action,
          if (status.otherPurchases.isNotEmpty) ...[
            const SizedBox(height: 14),
            const Text('Other eBay purchases', style: TextStyle(fontWeight: FontWeight.w600)),
            const Text('Not from a BagSpec deal. Add the ones you plan to flip.',
                style: TextStyle(color: BagSpecColors.muted, fontSize: 12)),
            for (final p in status.otherPurchases)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(children: [
                  DealImage(url: p.imageUrl, size: 44),
                  const SizedBox(width: 10),
                  Expanded(
                    child: InkWell(
                      onTap: () => openEbayLink(context, p.orderUrl ?? 'https://www.ebay.com/itm/${p.itemId}'),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                        Text('${money(p.price)} + ${money(p.shipping)} shipping',
                            style: const TextStyle(color: BagSpecColors.muted, fontSize: 12)),
                      ]),
                    ),
                  ),
                  TextButton(onPressed: busy ? null : () => onAdd(p), child: const Text('Add')),
                  TextButton(onPressed: busy ? null : () => onHide(p), child: const Text('Hide')),
                ]),
              ),
          ],
        ]),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, this.sub, this.color});
  final String label;
  final String value;
  final String? sub;
  final Color? color;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(color: BagSpecColors.muted, fontSize: 12)),
            const SizedBox(height: 6),
            Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color)),
            if (sub != null) Text(sub!, style: const TextStyle(color: BagSpecColors.muted, fontSize: 12)),
          ]),
        ),
      );
}

class _FlipTile extends StatelessWidget {
  const _FlipTile({required this.flip, required this.onTap});
  final Flip flip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final done = flip.sold || flip.status == 'failed';
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            DealImage(url: flip.imageUrl, size: 56),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Tag(flip.statusLabel, color: flip.sold ? BagSpecColors.green : flip.status == 'failed' ? BagSpecColors.red : BagSpecColors.amber),
                const SizedBox(height: 6),
                Text(flip.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              ]),
            ),
            const SizedBox(width: 8),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(done ? money(flip.profit) : money(flip.cost),
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16,
                      color: done ? ((flip.profit ?? 0) < 0 ? BagSpecColors.red : BagSpecColors.green) : null)),
              Text(done ? 'profit' : 'spent', style: const TextStyle(color: BagSpecColors.muted, fontSize: 12)),
              if (!done && flip.estimatedProfit != null)
                Text('est. ${money(flip.estimatedProfit)}', style: const TextStyle(color: BagSpecColors.muted, fontSize: 12)),
            ]),
          ]),
        ),
      ),
    );
  }
}
