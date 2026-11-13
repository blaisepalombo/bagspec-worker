import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';

/// One field in a [showFormSheet] form.
class FormFieldSpec {
  const FormFieldSpec(this.name, this.label, {this.money = false, this.required = false, this.initial, this.hint, this.options});
  final String name;
  final String label;
  final bool money;
  final bool required;
  final String? initial;
  final String? hint;

  /// When set, the field is a dropdown of (value, label) pairs.
  final List<(String, String)>? options;
}

String moneyText(double? value) => value == null ? '' : value.toStringAsFixed(2);

/// A bottom-sheet form like the website's pop-up forms. [onSubmit] gets the
/// values (money fields as doubles, blank fields left out) and may throw
/// [ApiException]; its message is shown in the sheet. Returns true if saved.
Future<bool> showFormSheet(
  BuildContext context, {
  required String title,
  required List<FormFieldSpec> fields,
  required String submitLabel,
  required Future<void> Function(Map<String, Object> values) onSubmit,
}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: BagSpecColors.surface,
    builder: (_) => _FormSheet(title: title, fields: fields, submitLabel: submitLabel, onSubmit: onSubmit),
  );
  return saved == true;
}

class _FormSheet extends StatefulWidget {
  const _FormSheet({required this.title, required this.fields, required this.submitLabel, required this.onSubmit});
  final String title;
  final List<FormFieldSpec> fields;
  final String submitLabel;
  final Future<void> Function(Map<String, Object> values) onSubmit;

  @override
  State<_FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<_FormSheet> {
  late final Map<String, TextEditingController> _text = {
    for (final f in widget.fields.where((f) => f.options == null)) f.name: TextEditingController(text: f.initial ?? ''),
  };
  late final Map<String, String?> _choice = {
    for (final f in widget.fields.where((f) => f.options != null)) f.name: f.initial ?? f.options!.first.$1,
  };
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final values = <String, Object>{};
    for (final f in widget.fields) {
      if (f.options != null) {
        values[f.name] = _choice[f.name]!;
        continue;
      }
      final raw = _text[f.name]!.text.trim();
      if (raw.isEmpty) {
        if (f.required) return setState(() => _error = '${f.label} is required.');
        continue;
      }
      if (f.money) {
        final number = double.tryParse(raw.replaceAll(r'$', '').replaceAll(',', ''));
        if (number == null || number < 0) return setState(() => _error = '${f.label} must be a dollar amount.');
        values[f.name] = number;
      } else {
        values[f.name] = raw;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit(values);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
        children: [
          Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          for (final f in widget.fields) ...[
            if (f.options != null)
              DropdownButtonFormField<String>(
                initialValue: _choice[f.name],
                decoration: InputDecoration(labelText: f.label, border: const OutlineInputBorder()),
                items: [for (final (value, label) in f.options!) DropdownMenuItem(value: value, child: Text(label))],
                onChanged: (value) => setState(() => _choice[f.name] = value),
              )
            else
              TextField(
                key: Key('field-${f.name}'),
                controller: _text[f.name],
                keyboardType: f.money ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
                decoration: InputDecoration(
                  labelText: f.label + (f.required ? ' *' : ''),
                  hintText: f.hint,
                  prefixText: f.money ? '\$ ' : null,
                  border: const OutlineInputBorder(),
                ),
              ),
            const SizedBox(height: 12),
          ],
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: BagSpecColors.red)),
            const SizedBox(height: 12),
          ],
          FilledButton(
            key: const Key('form-submit'),
            onPressed: _busy ? null : _submit,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: Text(_busy ? 'Saving…' : widget.submitLabel),
          ),
        ],
      ),
    );
  }
}
