import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../models.dart';
import '../theme.dart';
import 'deals_screen.dart';

class FlipsScreen extends StatefulWidget {
  const FlipsScreen({super.key, required this.api});
  final BagSpecApi api;

  @override
  State<FlipsScreen> createState() => _FlipsScreenState();
}

class _FlipsScreenState extends State<FlipsScreen> {
  Inventory? _inventory;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final inventory = await widget.api.inventory();
      if (mounted) {
        setState(() {
          _inventory = inventory;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inventory = _inventory;
    return Scaffold(
      appBar: AppBar(title: const Text('My flips')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: inventory == null
            ? ListView(children: [
                const SizedBox(height: 120),
                Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!)),
              ])
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                children: [
                  Row(children: [
                    Expanded(child: _Metric(label: 'Profit so far', value: money(inventory.totalProfit),
                        color: inventory.totalProfit < 0 ? BagSpecColors.red : BagSpecColors.green)),
                    const SizedBox(width: 10),
                    Expanded(child: _Metric(label: 'Money tied up', value: money(inventory.moneyTiedUp),
                        sub: '${inventory.open} not sold yet')),
                  ]),
                  const SizedBox(height: 16),
                  if (inventory.items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 40),
                      child: Text('No flips yet. Purchases from your connected eBay account show up here automatically.',
                          textAlign: TextAlign.center, style: TextStyle(color: BagSpecColors.muted)),
                    ),
                  for (final flip in inventory.items) ...[_FlipTile(flip: flip), const SizedBox(height: 10)],
                  const SizedBox(height: 8),
                  const Text('Update costs or mark items sold on bagspec.com for now.',
                      textAlign: TextAlign.center, style: TextStyle(color: BagSpecColors.muted, fontSize: 12)),
                ],
              ),
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
  const _FlipTile({required this.flip});
  final Flip flip;

  @override
  Widget build(BuildContext context) {
    final done = flip.sold || flip.status == 'failed';
    final url = Uri.tryParse(flip.itemUrl ?? '');
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: url == null || !url.host.endsWith('ebay.com') ? null : () => launchUrl(url, mode: LaunchMode.externalApplication),
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
