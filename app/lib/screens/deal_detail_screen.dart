import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models.dart';
import '../theme.dart';
import 'deals_screen.dart';

class DealDetailScreen extends StatelessWidget {
  const DealDetailScreen({super.key, required this.deal});
  final Deal deal;

  Future<void> _openOnEbay(BuildContext context) async {
    final url = Uri.tryParse(deal.itemUrl ?? '');
    final ok = url != null && url.host.endsWith('ebay.com') &&
        await launchUrl(url, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open eBay.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      if (deal.isAuction) ...[
        ('Current bid', money(deal.price)),
        if (deal.suggestedOffer != null) ('Bid up to', money(deal.suggestedOffer)),
        if (deal.endsAt != null) ('Ends', '${MaterialLocalizations.of(context).formatShortDate(deal.endsAt!)} ${TimeOfDay.fromDateTime(deal.endsAt!).format(context)}'),
      ] else
        ('Price', money(deal.price)),
      ('Shipping', money(deal.shipping)),
      ('Tax (est.)', money(deal.tax)),
      ('All-in cost', money(deal.totalBuyCost)),
      if (deal.partsCost != null) ('Parts (est.)', money(deal.partsCost)),
      if (deal.resaleLocal != null) ('Resale locally', money(deal.resaleLocal)),
      if (deal.resaleEbay != null) ('Resale on eBay', money(deal.resaleEbay)),
      ('Profit (est.)', money(deal.estimatedProfit)),
      if (deal.roiPercent != null) ('Return', '${deal.roiPercent!.toStringAsFixed(0)}%'),
      if (deal.repairRisk != null) ('Repair risk', '${deal.repairRisk!.toStringAsFixed(0)} / 10'),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(deal.category ?? 'Deal')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          Center(child: DealImage(url: deal.imageUrl?.replaceFirst('s-l225', 's-l500'), size: 240)),
          const SizedBox(height: 16),
          Wrap(spacing: 6, children: [
            Tag(deal.recommendation, color: deal.isBuy ? BagSpecColors.green : BagSpecColors.amber),
            if (deal.isAuction) Tag(deal.ended ? 'Auction ended' : 'Auction', color: BagSpecColors.muted),
            if (deal.bought) const Tag('Bought', color: BagSpecColors.green),
          ]),
          const SizedBox(height: 8),
          Text(deal.title, style: Theme.of(context).textTheme.titleLarge),
          if (deal.likelyIssue != null) ...[
            const SizedBox(height: 8),
            Text('Likely issue: ${deal.likelyIssue}', style: const TextStyle(color: BagSpecColors.muted)),
          ],
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              child: Column(children: [
                for (final (label, value) in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 7),
                    child: Row(children: [
                      Expanded(child: Text(label, style: const TextStyle(color: BagSpecColors.muted))),
                      Text(value, style: TextStyle(
                        fontWeight: label.startsWith('Profit') ? FontWeight.w700 : FontWeight.w500,
                        color: label.startsWith('Profit') ? BagSpecColors.green : null,
                      )),
                    ]),
                  ),
              ]),
            ),
          ),
          if (deal.explanation != null) ...[
            const SizedBox(height: 16),
            Text('Why BagSpec likes it', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 6),
            Text(deal.explanation!),
          ],
          if (deal.redFlags.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text('Watch out for', style: Theme.of(context).textTheme.titleSmall?.copyWith(color: BagSpecColors.amber)),
            const SizedBox(height: 6),
            for (final flag in deal.redFlags) Text('• $flag'),
          ],
          const SizedBox(height: 20),
          const Text('Estimates only. Check the listing and sold prices yourself before buying.',
              style: TextStyle(color: BagSpecColors.muted, fontSize: 12)),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: deal.itemUrl == null ? null : () => _openOnEbay(context),
            icon: const Icon(Icons.open_in_new),
            label: const Text('Open on eBay'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
        ],
      ),
    );
  }
}
